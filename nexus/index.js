const { ApolloServer } = require('apollo-server');
const { ApolloGateway, RemoteGraphQLDataSource } = require('@apollo/gateway');

const gateway = new ApolloGateway({
  buildService({name, url}) {
    return new IAMSignedSource({ url });
  }
});

class IAMSignedSource extends RemoteGraphQLDataSource {
  willSendRequest({ request, context}) {
    // TODO: Sign requests to graff with IAM credentials of environment.
    request.http.headers.set('x-user-id', 12);
  }
}

const server = new ApolloServer({
  gateway,
  // Subscriptions are not currently supported in Apollo Federation
  subscriptions: false
});

server.listen({port: process.env.PORT || 8080}).then(({ url }) => {
  console.log(`🚀 Gateway ready at ${url}`);
}).catch(err => {console.error(err)});