//This was used to import an existing Lambda. Steps:
//pulumi new aws-typescript project
//create a directory named app, download the Lambda code as a zip, and unpack it there
//run 'pulumi import aws:lambda/function:Function pulumi_function_name aws_function_name
//paste that code into index.ts and tweak as per the example below

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const pulumi_function_name = new aws.lambda.Function("pulumi_function_name", {
    architectures: ["x86_64"],
    ephemeralStorage: {
        size: 512,
    },
    handler: "index.handler",
    loggingConfig: {
        logFormat: "Text",
        logGroup: "/aws/lambda/aws_function_name_Stats",
    },
    name: "aws_function_name",
    packageType: "Zip",
    code: new pulumi.asset.AssetArchive({
        ".": new pulumi.asset.FileArchive("./app"),
    }),
    role: "arn:aws:iam::123456789:role/service-role/aws_function_name_Stats-role-abcdefg",
    runtime: "nodejs18.x",
    sourceCodeHash: "+xxxxxmOTphbZdil8pz9QhF89rqxGUSZAl3Wnxxxxxx=",
    timeout: 900,
    tracingConfig: {
        mode: "PassThrough",
    },
    vpcConfig: {
        securityGroupIds: ["sg-abc123456789"],
        subnetIds: [
            "subnet-12a34b56c78d",
            "subnet-12a34b78d56c",
        ],
    },
}, {
    protect: true,
});