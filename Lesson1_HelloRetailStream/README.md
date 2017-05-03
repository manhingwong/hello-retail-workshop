# Lesson 1: Create your own local copy of the hello-retail stream.
Goal: In order to prevent resource conflicts, you will have your own copy of the hello-retail kinesis event stream in your account.  Once you've created it, we will begin publishing events to it on the day of the conference using a fan-out lambda function on our core stream.

### Step 1: In your cloned repo, go to the ingress-stream directory

### Step 2: View the serverless.yml you find there
This yml file is used by the serverless.com deployment framework to deploy resources, services, and code to AWS.  You can see that there is a multi-shard Kinesis stream and a stream writer role with both the Public Cloud V2 managed policy (not required if you are using a non-Nordstrom account) and the stream writing policy that are deployed here.  This yml file contains the complete definition of resources and services that are deployed as part of your project.

You will also see some schema files here.  These are used to validate event schema, ensuring that events are well formed and as a partial protection against malicious or accidental attacks.

### Step 3: Deploy these components using the serverless.com framework
From your ingress-stream directory
```sh
$ serverless deploy -s $STAGE
```

### Step 4: confirm that the Kinesis stream deployed
Look in the AWS console under Kinesis you should see your stream there as *Stream, where * is your stage name.  No activity will be seen on it until you've connected to our fan-out lambda.

### Step 5: let the organizer know your complete Kinesis ARN and role ARN
If you are a Nordstrom employee, paste the information into the #serverless-workshop channel.  We will add you to our fan-out lambda and you'll start seeing traffic as the workshop progresses.
