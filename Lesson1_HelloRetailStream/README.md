#Lesson 1: Create your own local copy of the hello-retail stream.
Goal: In order to prevent resource conflicts, you will have your own copy of the hello-retail kinesis event stream in your account.  Once you've created it, we will begin publishing events to it on the day of the conference using a fan-out lambda function on our core stream.

###Step 1: In your cloned repo, go to the ingress-stream directory

###Step 2: View the serverless.yml you find there
This yml file is used by the serverless.com deployment framework to deploy resources, services, and code to AWS.  You can see that there is a multi-shard Kinesis stream and a stream writer role with both the Public Cloud V2 managed policy (not required if you are using a non-Nordstrom account) and the stream writing policy that are deployed here.  This yml file contains the complete definition of resources and services that are deployed as part of your project.

You will also see some schema files here.  These are used to validate event schema, ensuring that events are well formed and as a partial protection against malicious or accidental attacks.

###Step 3: Deploy these components using the serverless.com framework
From your ingress-stream directory
```sh
$ serverless deploy serverless.yml -s <stage name (e.g., your LAN ID)>
```

###Step 4: confirm that the Kinesis stream deployed
Look in the AWS console under Kinesis you should see your stream there as *Stream, where * is your stage name.  No activity will be seen on it until you've connected to our fan-out lambda.

###Step 5: paste your complete Kinesis ARN and role ARN into the #serverless-discuss channel.
We will add you to our fan-out lambda and you'll start seeing traffic as the workshop progresses.

If you're curious about the fan-out Lambda we're using to write to everyone's stream: https://github.com/awslabs/aws-lambda-fanout.  Here are the simplified instructions for using their CLI to deploy a fanout service.  *Note that this is not using the Serverless Framework for deployment and management.*
###Step A: Clone the aws-lambda-fanout repo and cd to the aws-lambda-fanout directory.  Since you've already set up your AWS credentials in Lesson 0, you can directly type
```sh
$ ./fanout deploy
```
The default lambda name will be fanout (same as using the option --function fanout).

###Step B: Register all source-to-target mappings.  Source is the hello-retail stream (Core Stream), in our use case, and target is your local copy of the hello-retail stream.  As an example of registering one kinesis stream to another kinesis stream:
```sh
$  ./fanout register kinesis --source-arn arn:aws:kinesis:<CoreStreamAWSRegion>:<CoreStreamAWSAccountNumber>:stream/<CoreStreamName> --id <stage>  --destination-region <YourAWSRegion> --active true --destination-role-arn <the role arn in Step 5 above> --destination <the Kinesis arn in Step 5 above>
```
The id does not have to be your stage, but does need to be something unique among all the source-to-target mappings, as these are stored in a Dynamo DB using the id as a key.
*If you do not set active true, you will need to activate the mapping in a separate step before you will receive any data.*
```sh
# $  ./fanout activate --source-arn <source arn you registered> --id <stage or whatever you set as the mapping's id>
```

###Step C: Register the kinesis source with the fanout lambda.
```sh
./fanout hook --source-arn arn:aws:kinesis:<CoreStreamAWSRegion>:<CoreStreamAWSAccountNumber>:stream/<CoreStreamName> --starting-position TRIM_HORIZON
```
It may take twenty minutes before the initial set of records are delivered and the local stream is truly streaming.
