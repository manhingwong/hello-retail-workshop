#Lesson 0: Before the workshop
Goal: Confirm access to a personal or public cloud V2 account, install node, update credentials, install serverless deployment framework

###Step 1: Install node.js
Ensure that you have [Node.js](https://nodejs.org/en/) (v4 or better) installed.

###Step 2: Ensure that you have access to a Nordstrom Public Cloud V2 account
Nordstrom Public Cloud V2 is a substantial improvement to Pub Cloud V1.  It gives you far greater access and control to all of the things.  This workshop will not work on a public cloud v1 account.  If you are not a Nordstrom engineer and you're reading this a public account will work just fine.

####Option 1: Your team already has a public cloud v2 account
***Need details on how to check this here.

####Option 2: Log in to the public cloud team's public cloud v2 sandbox account. (If you signed up for the workshop you should have access, if not ask for hel on the #serverless-discuss slack channel.
***add details on pub cloud v2 account

####Option 3: Use your own personal AWS account
****Rough cost estimate?
$4 for Kinesis
<$1 for Lambda
<$1 for DynamoDB
<$1 for API Gateway

###Step 2: serverless deployments requires AWS credentials

####Option 1:
Go to AWS IAM console --> users --> select your user ID --> security credentials tab
Select: Create Access Key
Download credentials csv file

```sh
<editor of choice> ~/.aws/credentials
```

Add to the credentials file:
```sh
[my-profile]
aws_access_key_id=<your access key ID from the credentials csv>
aws_secret_access_key=<your secret access key from the credentials csv>
```

From your terminal:
```sh
$ export AWS_PROFILE=my-profile
```

####Option 2:
You may already have these credentials on your machine using the AWS SDK, aws init, or some corporate utility.

```sh
$ export AWS_PROFILE=your-preexisting-profile
```

####Option 3:
Grab your credentials from a script, tool, or whatevs and add them to the environment.

```sh
$ export AWS_ACCESS_KEY_ID=<access-key-id>
$ export AWS_SECRET_ACCESS_KEY=<secret-access-key>
$ export AWS_SESSION_TOKEN=<session-token>             # this one is optional
```

###Step 3: install serverless v1.16+ node package on your machine.

####Note: if you are on a VPN and use a proxy, export your proxy to your shell
```sh
export proxy=https://your.proxy.com:1234
```

Regardless, install the the things
```sh
$ sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share} # this is for those of you who have corrupted your file system
$ npm install -g serverless
```

###Step 4: Deploy a simple lambda function