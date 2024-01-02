import { SNSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand  } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();

export const handler: SNSHandler = async (event: any) => {
  console.log("Event ", event);
  for (const record of event.Records) {    
    const snsMessage = JSON.parse(record.Sns.Message);

    if (snsMessage) {                                     
      const srcKey = snsMessage.name; 
      const description = snsMessage.description; 
      console.log("Updating image description in DynamoDB")
      await ddbDocClient.send(
        new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { ImageName: srcKey },
            UpdateExpression: "set Description = :desc",
            ExpressionAttributeValues: {
                ":desc": description
            }
        })
      )
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