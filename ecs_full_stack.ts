//To use this, do 'pulumi new' to create a new aws-typescript project, then paste this into index.ts and customize to your env. 
//The AWS CLI will also need to be configured for authentication.

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// My existing Prod stack's values - VPC, public/private subnets, roles, Route53
const vpc = "vpc-12345678"; //your VPC id here
const pubSubs = ["subnet-12345678", "subnet-87654321"] //public subnets here
const privSubs = ["subnet-23456789", "subnet-98765432"] //private subnets here
const execIamRole = "arn:aws:iam::123456789:role/test-use1-iam-sgs-ro-EcsTaskExecutionRole"
// const serviceRole = "arn:aws:iam::123456789:role/aws-service-role/ecs.amazonaws.com/AWSServiceRoleForECS" // doesn't seem to be needed now, but left for transparency
const scalingRole = "arn:aws:iam::123456789:role/aws-service-role/ecs.application-autoscaling.amazonaws.com/AWSServiceRoleForApplicationAutoScaling_ECSService";
const webCert = "arn:aws:iam::123456789:certificate/guid";
const r53ZoneID = aws.route53.getZone({ name: "domainname.org." });
const stdCPU = 1024;
const stdMEM = 2048;
const SysName = "mysystem";
const SysEnv = "test";
const SysRegion = "east";
const FullRegion = "us-east-1";
const R53Name = "mysystem.domainname.org"
const DockerImg = "123456789.dkr.ecr.us-east-1.amazonaws.com/mysystem:test";

const Parameters = [
    {
        name: "environment",
        valueFrom: "arn:aws:ssm:us-east-1:123456789:parameter/test/mysystem/env/environment"
    },
    {
        name: "othervariable",
        valueFrom: "arn:aws:ssm:us-east-1:123456789:parameter/test/mysystem/env/othervariable"
    },
]

const envStub = `${SysName}-${SysEnv}-${SysRegion}`;
const envStubU = `${SysName}_${SysEnv}_${SysRegion}`;

//change nothing below this
const lbsg = new aws.ec2.SecurityGroup(`${envStub}-lbsg`, {
    name: `${envStub}-lbsg`,
    description: "Enable HTTPS access",
    vpcId: `${vpc}`,
});

const lbIngress = new aws.ec2.SecurityGroupRule(`${envStub}-https-ingress`, {
    type: "ingress",
    fromPort: 443,
    toPort: 443,
    protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"],
    securityGroupId: lbsg.id,
});

// Create an egress rule for allowing all outbound traffic
const lbdefaultEgressRule = new aws.ec2.SecurityGroupRule(`${envStub}-lbdefault-egress`, {
    type: "egress",
    fromPort: 0,
    toPort: 0,
    protocol: "-1",
    cidrBlocks: ["0.0.0.0/0"],
    securityGroupId: lbsg.id,
});

const tasksg = new aws.ec2.SecurityGroup(`${envStub}-tasksg`, {
    name: `${envStub}-tasksg`,
    description: "Enable port 80 access",
    vpcId: `${vpc}`,
});

const taskIngress = new aws.ec2.SecurityGroupRule(`${envStub}-http-ingress`, {
    type: "ingress",
    fromPort: 80,
    toPort: 80,
    protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"],
    securityGroupId: tasksg.id,
});

// Create an egress rule for allowing all outbound traffic
const defaultEgressRule = new aws.ec2.SecurityGroupRule(`${envStub}-default-egress`, {
    type: "egress",
    fromPort: 0,
    toPort: 0,
    protocol: "-1",
    cidrBlocks: ["0.0.0.0/0"],
    securityGroupId: tasksg.id,
});

const alb = new aws.lb.LoadBalancer(`${envStub}-alb`, {
    name: `${envStub}-alb`,
    internal: false,
    loadBalancerType: "application",
    securityGroups: [lbsg.id],
    subnets: pubSubs,
    enableDeletionProtection: true,
    tags: {
        Environment: "test",
    },
});

// Create a target group for the load balancer to route traffic to
const tg = new aws.lb.TargetGroup(`${envStub}-tg`, {
    name: `${envStub}-tg`,
    port: 80,
    protocol: 'HTTP',
    targetType: 'ip',
    vpcId: vpc,
});

// Create a listener for incoming traffic on the load balancer
const listener = new aws.lb.Listener(`${envStub}-listener`, {
    loadBalancerArn: alb.arn,
    port: 443,
    protocol: "HTTPS",
    sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    certificateArn: webCert,
    defaultActions: [{
        type: "forward",
        targetGroupArn: tg.arn,
    }],
});

const example = new aws.elasticache.Cluster(`${envStub}-cache`, {
    clusterId: `${envStub}-cache`,
    engine: "memcached",
    nodeType: "cache.t3.medium",
    numCacheNodes: 2,
    subnetGroupName: "memcache-test-subnetgroup",
    parameterGroupName: "default.memcached1.6",
    port: 11211,
});

const lg = new aws.cloudwatch.LogGroup(`${envStub}-lg`, {
    name: `/ecs/${envStub}`,
    tags: {
        Environment: SysEnv,
        Application: SysName,
    },
});

const td = new aws.ecs.TaskDefinition(`${envStub}-td`, {
    containerDefinitions: JSON.stringify([
  {
    name: `${envStub}-svc`,
    image: DockerImg,
    cpu: stdCPU,
    memory: stdMEM,
    memoryReservation: stdMEM,
    essential: true,
    portMappings: [{
        name: `${envStub}-80-tcp`,
        containerPort: 80,
        hostPort: 80,
        protocol: "tcp"
    }],
    secrets: Parameters,
    "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
            "awslogs-group": `/ecs/${envStub}`,
            "awslogs-region": `${FullRegion}`,
            "awslogs-stream-prefix": "ecs"
        }
    }
  }
]),
    cpu: String(stdCPU),
    family: `${envStub}`,
    memory: String(stdMEM),
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    executionRoleArn: execIamRole,
});

const cluster = new aws.ecs.Cluster(`${envStub}-cluster`, {
    name: `${envStub}-cluster`,
   settings: [{
      name: "containerInsights",
      value: "enabled",
  }]});

const service = new aws.ecs.Service(`${envStub}-service`, {
    cluster: cluster.arn,
    name: `${envStub}-service`,
    taskDefinition: td.arn,
    launchType: "FARGATE",
    desiredCount: 2,
//    iamRole: serviceRole,  //doesn't seem to be needed now, but left for transparency
networkConfiguration: {
    assignPublicIp: false,
    subnets: privSubs,
    securityGroups: [tasksg.id],
},
loadBalancers: [{
        targetGroupArn: tg.arn,
        containerName: `${envStub}-svc`,
        containerPort: 80,
    }],
});

const scaling_target = new aws.appautoscaling.Target(`${envStub}-scaling-target`, {
    maxCapacity: 25,
    minCapacity: 2,
    resourceId: `service/${envStub}-cluster/${envStub}-service`,
    roleArn: scalingRole,
    scalableDimension: "ecs:service:DesiredCount",
    serviceNamespace: "ecs",
},);

export const loadBalancerNumericId = alb.arn.apply(arn => {
    // Split the ARN by `:` to isolate the components
    const arnParts = arn.split(":");
    // The numeric identifier is typically the last part after the final `:`
    const lastPart = arnParts[arnParts.length - 1];
    // Return the numeric identifier (assuming it is at the end of the ARN)
    return lastPart.split("/").pop() ?? "";
});

export const tgNumericId = tg.arn.apply(arn => {
    // Split the ARN by `:` to isolate the components
    const arnParts = arn.split(":");
    // The numeric identifier is typically the last part after the final `:`
    const lastPart = arnParts[arnParts.length - 1];
    // Return the numeric identifier (assuming it is at the end of the ARN)
    return lastPart.split("/").pop() ?? "";
});

const albLabel= pulumi.interpolate `app/${alb.name}/${loadBalancerNumericId}/targetgroup/${tg.name}/${tgNumericId}`

const autoscale_policy = new aws.appautoscaling.Policy(`${envStub}-autoscale-policy`, {
    name: `${envStub}-LB-Scaling`,
    policyType: "TargetTrackingScaling",
    resourceId: `service/${envStub}-cluster/${envStub}-service`,
    scalableDimension: "ecs:service:DesiredCount",
    serviceNamespace: "ecs",
    targetTrackingScalingPolicyConfiguration: {
        predefinedMetricSpecification: {
            predefinedMetricType: "ALBRequestCountPerTarget",
            resourceLabel: albLabel,
        },
        scaleInCooldown: 300,
        scaleOutCooldown: 300,
        targetValue: 300,
    },
},);

const cpu_scaling_policy = new aws.appautoscaling.Policy(`${envStub}-cpu-scaling`, {
    name: `${envStub}-CPU-Scaling`,
    policyType: "TargetTrackingScaling",
    resourceId: `service/${envStub}-cluster/${envStub}-service`,
    scalableDimension: "ecs:service:DesiredCount",
    serviceNamespace: "ecs",
    targetTrackingScalingPolicyConfiguration: {
        predefinedMetricSpecification: {
            predefinedMetricType: "ECSServiceAverageCPUUtilization",
        },
        scaleInCooldown: 300,
        scaleOutCooldown: 300,
        targetValue: 30,
    },
},);

//Configure a CNAME record for the www subdomain, pointing it to an S3 bucket
const record = new aws.route53.Record(`${envStub}-Cname-Record`, {
    // reference the zone's zoneId
    zoneId: r53ZoneID.then(z => z.id),
    name: R53Name, // this will create a record for "www.mydomain.com"
    allowOverwrite: true,
    type: "A",
    aliases: [{
        name: alb.dnsName,
        zoneId: alb.zoneId,
        evaluateTargetHealth: false,
    }],
});

// Output the DNS name of the load balancer to access it
export const albDnsName = alb.loadBalancer.dnsName;