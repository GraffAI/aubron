# See here for image contents: https://github.com/microsoft/vscode-dev-containers/tree/v0.233.0/containers/javascript-node/.devcontainer/base.Dockerfile

# [Choice] Node.js version (use -bullseye variants on local arm64/Apple Silicon): 18, 16, 14, 18-bullseye, 16-bullseye, 14-bullseye, 18-buster, 16-buster, 14-buster
ARG VARIANT="18-bullseye"
FROM mcr.microsoft.com/vscode/devcontainers/javascript-node:0-${VARIANT}

# [Optional] Uncomment this section to install additional OS packages.
# RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
#     && apt-get -y install --no-install-recommends <your-package-list-here>

RUN apt-get update && apt-get -y install --no-install-recommends python3-pip

# [Optional] Uncomment if you want to install an additional version of node using nvm
# ARG EXTRA_NODE_VERSION=10
# RUN su node -c "source /usr/local/share/nvm/nvm.sh && nvm install ${EXTRA_NODE_VERSION}"


# Add pscale cli
RUN curl -sLO https://github.com/planetscale/cli/releases/download/v0.94.0/pscale_0.94.0_linux_amd64.deb
RUN dpkg -i ./pscale_0.94.0_linux_amd64.deb

# Add rover cli
RUN curl -sSL https://rover.apollo.dev/nix/latest | sh

# Add AWS Elastic Beanstalk CLI
RUN pip install awsebcli --upgrade --user

RUN aws configure set aws_access_key_id $AWS_ACCESS_KEY_ID \
    && aws configure set aws_secret_access_key $AWS_SECRET_ACCESS_KEY \
    && aws configure set region $AWS_DEFAULT_REGION

# [Optional] Uncomment if you want to install more global node modules
RUN su node -c "npm install -g prisma serverless @aws-amplify/cli"
