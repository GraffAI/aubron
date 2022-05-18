// graphql.js

const { ApolloServer, gql } = require('apollo-server-lambda');
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient();
// Construct a schema, using GraphQL schema language
const typeDefs = gql`
  type Query {
    hello: String
    test: String
  }
`;

// Provide resolver functions for your schema fields
const resolvers = {
  Query: {
    hello: () => 'Hello world!',
    test: async () => {
      console.log(await prisma.user.findMany());
      return 'ha';
    }
  },
};

const server = new ApolloServer({ typeDefs, resolvers, csrfPrevention: true });

exports.graphqlHandler = server.createHandler();