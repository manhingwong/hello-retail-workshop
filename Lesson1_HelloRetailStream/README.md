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


## Extra Credit: Using the AWS CLI to show Role and Stream ARNs

Using the [AWS CLI](../Lesson0_BeforeWorkshop/SETUP-AWS-CLI.md), you can execute this script to show the ARNs needed:

```sh
./show-stream-and-role-arns.sh
```

It contains the following two commands:

```sh
aws iam list-roles | grep Arn | grep $STAGE | sed -n "s/^.*\(arn\:aws\:iam\:\:[0-9]*\:role\/.*StreamWriter\).*/\1/p"
aws kinesis describe-stream --stream-name `aws kinesis list-streams | grep $STAGE | sed -n "s/^.*\"\(.*\)\".*/\1/p"` | grep StreamARN | sed -n "s/^.*\(arn\:aws\:kinesis\:.*Stream\).*/\1/p"
```

1. Here we invoke AWS CLI to list all of the roles in the account, using `aws iam list-roles`. We then use `grep` and `sed` to filter and shape the output until only the ARN for the StreamWriter role is left.
2. This two-step command starts by using the AWS command `aws kinesis list-streams` to output the names of all the Kinesis streams in the account, then we `grep` and get our stream name, which we pass to the `aws kinesis describe-stream` as the `stream-name` parameter. From all of the many properties provided for our stream, we `grep` and `sed` to just get the ARN value.

You can run the commands above removing the `grep` and `sed` portions to explore the output in its raw form and you might notice that the output is in JSON, if you have the AWS CLI configured for that.

Ultimately, `grep` and `sed` are not very maintainable as a solution and don't take advantage of the structure provided by the output.
It's recommended that you stream the output of these commands to other tools, e.g. JQ.