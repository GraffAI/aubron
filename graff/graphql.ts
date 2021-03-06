// graphql.js

import { ApolloServer, gql } from 'apollo-server-lambda';
import { PrismaClient } from '@prisma/client';
import { loadSchema } from '@graphql-tools/load';
import { GraphQLFileLoader } from '@graphql-tools/graphql-file-loader';


module.exports.graphqlHandler = async (event, context, callback) => {
  
  const prisma = new PrismaClient();
  // Construct a schema, using GraphQL schema language
  // TODO: Figure out how to use prisma types here where useful.
  const typeDefs = await loadSchema('graff.graphql',{
    loaders: [new GraphQLFileLoader()]
  })
  
  // Provide resolver functions for your schema fields
  const resolvers = {
    Query: {
      hello: () => 'Hello world!',
      users: () => prisma.user.findMany()
    },
  };
  
  
  const server = new ApolloServer({ typeDefs, resolvers, csrfPrevention: true });
  let handler = server.createHandler();
  return handler(event, context, callback);
}