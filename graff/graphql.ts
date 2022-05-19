// graphql.js

import { ApolloServer, gql } from 'apollo-server-lambda';
import { PrismaClient } from '@prisma/client';
import { loadSchema } from '@graphql-tools/load';
import { GraphQLFileLoader } from '@graphql-tools/graphql-file-loader';


const main = async () => {
  
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
  return server.createHandler();
}

exports.graphqlHandler = main();