// graphql.js

const { ApolloServer, gql } = require('apollo-server-lambda');
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient();
// Construct a schema, using GraphQL schema language
// TODO: Figure out how to use prisma types here where useful.
const typeDefs = gql`
  type Query {
    hello: String
    users: [User]!
  }

  type User {
    id: String!
    email: String
    type: USER_TYPE!
  }

  enum USER_TYPE {
    USER
    ADMIN
  }
`;

// Provide resolver functions for your schema fields
const resolvers = {
  Query: {
    hello: () => 'Hello world!',
    users: () => prisma.user.findMany()
  },
};

const server = new ApolloServer({ typeDefs, resolvers, csrfPrevention: true });

exports.graphqlHandler = server.createHandler();