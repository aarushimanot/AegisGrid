// AWS SDK clients, created once per Lambda container and reused across invocations.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { SNSClient } from "@aws-sdk/client-sns";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { ComprehendClient } from "@aws-sdk/client-comprehend";
import { TranslateClient } from "@aws-sdk/client-translate";
import { SFNClient } from "@aws-sdk/client-sfn";
import { SSMClient } from "@aws-sdk/client-ssm";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
});
export const s3 = new S3Client({});
export const eventBridge = new EventBridgeClient({});
export const sns = new SNSClient({});
export const ses = new SESv2Client({});
export const rekognition = new RekognitionClient({});
export const comprehend = new ComprehendClient({});
export const translate = new TranslateClient({});
export const sfn = new SFNClient({});
export const ssm = new SSMClient({});
export const cognito = new CognitoIdentityProviderClient({});
