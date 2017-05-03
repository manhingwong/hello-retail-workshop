# Lesson 0: Before the workshop
Goal: Install everything needed for the workshop and confirm that you can login to a public cloud v2 account.

### Step 1: Clone the Hello-Retail-Workshop repo on your local machine

Go to https://github.com/Nordstrom/hello-retail-workshop and fork our Repo, then clone it locally.

From your workshop directory:
```sh
$ git clone https://github.com/<GitHubID>/hello-retail-workshop.git
```
For more information on using github, go to https://help.github.com/articles/fork-a-repo/

### Step 2: Install node.js
Ensure that you have [Node.js](https://nodejs.org/en/) (v4 or better) installed.
We suggest using [NVM](https://github.com/creationix/nvm/blob/master/README.markdown) to allow side-by-side install of different node versions.

Use the following script provided in the repository to check your NodeJS version and install dependencies (Mac/Linux):
```sh
$ ./setup-nodejs.sh
```

### Step 3: Setup your AWS credentials
```
If you are a Nordstrom Technology engineer, please see the page titled "Serverless Workshop - Nordstrom AWS Credentials Setup" in Confluence and follow the instructions there.
```

Otherwise, install the [AWS-CLI](SETUP-AWS-CLI.md) and use the `aws configure` command to setup your credentials.

Your credentials are located in the AWS Console under:

IAM --> users --> select your user ID --> security credentials tab

If you use any AWS profile other than the default, you'll need to provide that profile name to the environment via the `AWS_PROFILE` variable:

From your terminal:
```sh
$ export AWS_PROFILE=my-profile
```

### Step 4: install serverless node package on your machine.

#### Note: if you are on a VPN and use a proxy, export your proxy to your shell
```sh
export proxy=https://your.proxy.com:1234
```

Regardless, install the serverless.com deployment framework - this will make it easy to deploy serverless components to AWS
```sh
# $ sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}
# Uncomment the above if you have corrupted your file system and are on MacOSX.
$ npm install -g serverless
```

### Step 5: serverless deployments require some information you may not want to check in to a public repo.  Fill in the information in private.yml.

There's an example private.yml in the project with the values in the correct format. Specific values will be available during the workshop.

```yml
region: us-east-1

profile: your-preexisting-profile
accountId: 999999999999

teamRole: MY-TEAM-DevUsers-Team
teamPolicy: arn:aws:iam::99999999999:policy/appteam/that-managed-policy-name-if-you-are-in-public-cloud-v2

# deploymentBucket: #<optional S3 bucket> # uncomment the use of this variable in your serverless.yml files to deploy to a specific bucket

# Core Stream
coreStream:
  accountId: 8888888888888
  awslabsRoleArn: arn:aws:iam::${self:custom.private.coreStream.accountId}:role/fanoutRole

```

### Step 6: choose a unique $STAGE name and set the $REGION for your deployed services

We recommend you use your LAN ID to ensure it's unique, but you can use any name you want. Go ahead and set a shell variable to use later on:

```sh
export STAGE=b0bb
export REGION=us-west-2
```

For the rest of the workshop, the commands will reference `$STAGE` and `$REGION` and you will be able to find your components in the AWS console using your stage name.

