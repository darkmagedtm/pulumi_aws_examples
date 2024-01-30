//To use this, do 'pulumi new' to create a new aws-typescript project, then paste this into index.ts and customize to your env. 
//The AWS CLI will also need to be configured for authentication.

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// My existing Prod stack's values - VPC, public/private subnets, roles, Route53
const vpc = "vpc-12345678";
const pubSubs = ["subnet-12345678", "subnet-87654321"]
const privSubs = ["subnet-23456789", "subnet-98765432"]
const execIamRole = "arn:aws:iam::123456789:role/test-use1-iam-sgs-ro-EcsTaskExecutionRole"
const serviceRole = "arn:aws:iam::123456789:role/aws-service-role/ecs.amazonaws.com/AWSServiceRoleForECS"
const r53ZoneID = "ZTYXW98754"

//New security group for the load balancer
const prod_east_lbsg = new aws.ec2.SecurityGroup("prod-east-lbsg", {
    description: "Enable HTTPS access",
    ingress: [
        // Allow inbound traffic from anywhere in the world on port 443 (HTTPS)
        {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
    egress: [
        // Allow outbound traffic to any destination
        {
            protocol: "-1", 
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
});

//New security group for the ECS tasks
const prod_east_tasksg = new aws.ec2.SecurityGroup("prod-east-tasksg", {
    description: "Enable port 80 access",
    ingress: [
        // Allow inbound traffic from anywhere in the world on port 80 (HTTP)
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
    egress: [
        // Allow outbound traffic to any destination
        {
            protocol: "-1", 
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
});

//New Load Balancer
const prod_east_alb = new aws.lb.LoadBalancer("prod-east-alb", {
    internal: false,
    loadBalancerType: "application",
    securityGroups: [prod_east_lbsg.id],
    subnets: pubSubs,
    enableDeletionProtection: true,
    tags: {
        Environment: "production",
    },
});

// Create a target group for the load balancer to route traffic to
const prod_east_tg = new aws.lb.TargetGroup("prod-east-tg", {
    port: 80,
    protocol: 'HTTP',
    targetType: 'ip',
    vpcId: vpc,
});

// Create a listener for incoming traffic on the load balancer
const prod_east_listener = new aws.lb.Listener("prod-east-listener", {
    loadBalancerArn: prod_east_alb.arn,
    port: 443,
    protocol: "HTTPS",
    sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    certificateArn: "arn:aws:acm:us-east-1:123456789:certificate/<SID>",
    defaultActions: [{
        type: "forward",
        targetGroupArn: prod_east_tg.arn,
    }],
});

//New Task Defintion - this took a lot of tweaking
const prod_east_td = new aws.ecs.TaskDefinition("prod-east-td", {
    containerDefinitions: JSON.stringify([
  {
    name: "prod-east-svc",
    //we use a private ECR image pushed by our current code control system
    image: "123456789.dkr.ecr.us-east-1.amazonaws.com/image:production",
    cpu: 1024,
    memory: 2048,
    essential: true,
    portMappings: [{
        containerPort: 80,
        hostPort: 80,
    }],
    //we use Parameter store for environment variables. Examples included
    secrets: [
        {
            name: "environment",
            valueFrom: "arn:aws:ssm:us-east-1:123456789:parameter/prod/app/env/environment"
        },
        {
            name: "PRIVATE_CERT",
            valueFrom: "arn:aws:ssm:us-east-1:123456789:parameter/prod/app/env/PRIVATE_CERT"
        },
        {
            name: "PUBLIC_CERT",
            valueFrom: "arn:aws:ssm:us-east-1:123456789:parameter/prod/app/env/PUBLIC_CERT"
        },
    ],
  }
]),
    cpu: "1024",
    family: "prod-east",
    memory: "2048",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    executionRoleArn: execIamRole,
});

//New ECS Cluster
const prod_east_cluster = new aws.ecs.Cluster("prod-east-cluster", {settings: [{
    name: "containerInsights",
    value: "enabled",
}]});

//New ECS Service
const prod_east_service = new aws.ecs.Service("prod-east-service", {
    cluster: prod_east_cluster.arn,
    taskDefinition: prod_east_td.arn,
    launchType: "FARGATE",
    desiredCount: 2,
networkConfiguration: {
    assignPublicIp: false,
    subnets: privSubs,
    securityGroups: [prod_east_tasksg.id],
},
loadBalancers: [{
        targetGroupArn: prod_east_tg.arn,
        containerName: "prod-east-svc",
        containerPort: 80,
    }],
});

// Configure a CNAME record for the www subdomain, pointing it to an S3 bucket
const record = new aws.route53.Record("appCnameRecord", {
    // reference the zone's zoneId
    zoneId: r53ZoneID,
    name: "app", // this will create a record for "www.mydomain.com"
     // this is the type of DNS record you're creating. In this case it's CNAME
    type: "CNAME",
    // the value of the record; replace "mybucket" with your S3 bucket name
    records: [prod_east_alb.dnsName],
    ttl: 300, // time-to-live; you may select a suitable value for your use case
});
