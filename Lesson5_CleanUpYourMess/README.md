# Lesson 4: Clean up your mess!

Innovate, experiment, but flush when your're done! Don't leave unused resources in your team's AWS accounts.  The Lambdas and API Gateways will only cost you money while used, but the Kinesis streams and DynamoDB tables will charge part of their cost just for existing.  Delete everything when you're done!

## remove winner-api

In the Lesson 2 directory, run:

```sh
serverless remove -s $STAGE
```

You should see a message from Serverless when you stack is removed.

## remove ingress-stream

_*** IMPORTANT! ***_

BEFORE REMOVING YOUR STREAM, BE SURE TO INFORM THE WORKSHOP INSTRUCTOR AND PROVIDE YOUR STREAM ARN.

If you do not, it is possible that backups can occur with the fan-out stream.

Once you've been given the all-clear please delete your stream.

In the Lesson 3 directory, run:

```sh
serverless remove -s $STAGE
```

You should see a message from Serverless when you stack is removed.

## serverless reference

For more information on removing services see the Serverless.com documentation for [remove](https://serverless.com/framework/docs/providers/aws/cli-reference/remove/#aws---remove).
