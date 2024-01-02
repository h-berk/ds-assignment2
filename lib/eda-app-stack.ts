import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";

import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    const imageTable = new dynamodb.Table(this, "ImageTable", {
      tableName: "Images",
      partitionKey: {
        name: "ImageName", 
        type: dynamodb.AttributeType.STRING, 
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Integration infrastructure

    const deadLetterQueue = new sqs.Queue(this, "dead-letter-queue", { 
      retentionPeriod: cdk.Duration.minutes(30),
    });

    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 2 // Stops images that arent processed successfully from filling up dead letter queue.
      }
    });

    //SNS Topic
    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    }); 

    const existingImageTopic = new sns.Topic(this, "ExistingImageTopic", {
      displayName: "Existing Image topic",
    }); 

    // Lambda functions

    const processImageFn = new lambdanode.NodejsFunction(
      this,
      "ProcessImageFn",
      {
        // architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/processImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imageTable.tableName,
          REGION: 'eu-west-1',
        },
        deadLetterQueue: deadLetterQueue
      }
    );

    const deleteImageFn = new lambdanode.NodejsFunction(
      this,
      "DeleteImageFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/deleteImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imageTable.tableName,
          REGION: 'eu-west-1',
        }
      }
    );

    const updateImageDescriptionFn = new lambdanode.NodejsFunction(
      this,
      "UpdateImageDescriptionFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/updateImageDescription.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imageTable.tableName,
          REGION: 'eu-west-1',
        }
      }
    );

    const confirmationMailerFn = new lambdanode.NodejsFunction(this, "confirmation-mailer-function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
    });

    const rejectionMailerFn = new lambdanode.NodejsFunction(this, "rejection-mailer-function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
    });

  // Topic 1 Subscriptions
  const lambdaSub = new subs.LambdaSubscription(confirmationMailerFn) 
  const queueSub = new subs.SqsSubscription(imageProcessQueue)

  newImageTopic.addSubscription(lambdaSub); //Confirmation mailer directly subscribed to newImageTopic 
  newImageTopic.addSubscription(queueSub);

  // Topic 2 Subscriptions
  const deleteSub = new subs.LambdaSubscription(deleteImageFn) 
  //Filter to update caption
  const updateSub = new subs.LambdaSubscription(updateImageDescriptionFn, {
    filterPolicy: {
      comment_type: sns.SubscriptionFilter.stringFilter({
        allowlist: ["Caption"], 
      }),
    }
  });

  existingImageTopic.addSubscription(deleteSub); 
  existingImageTopic.addSubscription(updateSub); 

  


  // Event triggers

  imagesBucket.addEventNotification(
    s3.EventType.OBJECT_CREATED,
    new s3n.SnsDestination(newImageTopic)  // Changed
);

  imagesBucket.addEventNotification( 
  s3.EventType.OBJECT_REMOVED,
  new s3n.SnsDestination(existingImageTopic) // Added
  );


  const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(10),
  });

  const rejectionMailerEventSource = new events.SqsEventSource(deadLetterQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(10),
  });


  processImageFn.addEventSource(newImageEventSource);
  rejectionMailerFn.addEventSource(rejectionMailerEventSource);


  // Permissions
  //Process Image Lambda
  imagesBucket.grantRead(processImageFn);
  imageTable.grantReadWriteData(processImageFn);

  // Delete Image Lambda
  imagesBucket.grantReadWrite(deleteImageFn);
  imageTable.grantReadWriteData(deleteImageFn);

  // Update Image Description Lambda
  imagesBucket.grantReadWrite(updateImageDescriptionFn);
  imageTable.grantReadWriteData(updateImageDescriptionFn);

  confirmationMailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );

  rejectionMailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );


    // Output
    
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });

    new cdk.CfnOutput(this, "topicARN", {
      value: existingImageTopic.topicArn, //Needed to update image description
    });
  }
}
