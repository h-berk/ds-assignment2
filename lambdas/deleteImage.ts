import { SNSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();

export const handler: SNSHandler = async (event: any) => {
  console.log("Event ", event);
  for (const record of event.Records) {    
    const snsMessage = JSON.parse(record.Sns.Message);

    if (snsMessage.Records) {
      console.log("Message body ", JSON.stringify(snsMessage));
      for (const messageRecord of snsMessage.Records) {     
        if (messageRecord.eventName.startsWith("ObjectRemoved:")) {                            
            const s3e = messageRecord.s3;                                           
            const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
            console.log("Deleting image from DynamoDB")
            await ddbDocClient.send(
                new DeleteCommand({
                TableName: process.env.TABLE_NAME,
                Key: {
                    "ImageName": srcKey
                }
                })
            )
      }
    }
    }
  }
}

function createDDbDocClient() {
    const ddbClient = new DynamoDBClient({ region: process.env.REGION });
    const marshallOptions = {
      convertEmptyValues: true,
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    };
    const unmarshallOptions = {
      wrapNumbers: false,
    };
    const translateConfig = { marshallOptions, unmarshallOptions };
    return DynamoDBDocumentClient.from(ddbClient, translateConfig);
  }