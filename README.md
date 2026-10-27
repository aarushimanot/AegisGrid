# AegisGrid

AI multi-agent emergency response platform on AWS (VIT Cloud Architecture Design project).

| Folder | Contents |
|---|---|
| [`backend/`](backend/README.md) | AWS SAM application: Lambda (TypeScript), API Gateway, Step Functions, EventBridge, DynamoDB, Cognito, Bedrock and the AI perception services. Deployment guide in its README. |
| [`frontend/`](frontend/README.md) | React web app for citizens, emergency service stations and the admin; hosted on S3 + CloudFront. Runs in demo mode without AWS. |
