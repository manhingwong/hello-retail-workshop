# Using a Fanout

If you're curious about the fan-out Lambda we're using to write to everyone's stream: https://github.com/Nordstrom/aws-lambda-fanout, which is forked from https://github.com/awslabs/aws-lambda-fanout.  Here are the simplified instructions for using their CLI to deploy a fanout service.  *Note that this is not using the Serverless Framework for deployment and management.*
### Step A: Clone the aws-lambda-fanout repo and cd to the aws-lambda-fanout directory.  Ensure you have set up your AWS credentials for the account in which you have deployed hello-retail.  Then you can directly type
```sh
$ ./fanout deploy
```
The default lambda name will be fanout (same as using the option --function fanout).  You can also deploy changes to the fanout lambda using this command.

### Step B: Register all source-to-target mappings.  Source is the hello-retail stream (Core Stream), in our use case, and target is the local copy of the hello-retail stream.  As an example of registering one kinesis stream to another kinesis stream:
```sh
$  ./fanout register kinesis --source-arn arn:aws:kinesis:<CoreStreamAWSRegion>:<CoreStreamAWSAccountNumber>:stream/<CoreStreamName> --id $STAGE  --destination-region $REGION --active true --parallel false --destination-role-arn <the role arn in Step 5 above> --destination <the Kinesis arn in Step 5 above>
```
The id does not have to be your stage, but does need to be something unique among all the source-to-target mappings, as these are stored in a Dynamo DB using the id as a key.
*To use the winner solution in Lesson 2, parallel must be set to false.*  Without parallel set to false, in-shard ordering is not guaranteed on forwarding by the fanout.  The alternative winner solution in Lesson 6 is meant to work in the case where parallel is true or the parameter is missing (as true is the default).
*If you do not set active true, you will need to activate the mapping in a separate step before you will receive any data.*
```sh
# $  ./fanout activate --source-arn <source arn you registered> --id <stage or whatever you set as the mapping's id>
```

### Step C: Register the kinesis source with the fanout lambda.
```sh
./fanout hook --source-arn arn:aws:kinesis:<CoreStreamAWSRegion>:<CoreStreamAWSAccountNumber>:stream/<CoreStreamName> --starting-position TRIM_HORIZON
```
It may take ten minutes before the initial set of records are delivered and the local stream is truly streaming.  The local stream will get only the events that the fanout has processed since the registration was activated for the local stream.  To get the full stream, hook the kinesis stream to the fanout after all local streams have been registered and activated.

## Using the AWS CLI to show Role and Stream ARNs

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