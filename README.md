# Aubron's Personal Infrastructure Monorepo

This repository contains a monorepo of the critical infrastructure powering SAM, a natural language life management engine designed to operate as a security system, task and queue management tool, and smarthome platform.

## The path diverges ahead:

This 

### [/bifrost/](/bifrost/) - **Bifrost**
The bridge to reality. A microservice run at all local sites, meant to bridge local network access and expose the real world to the network. Apollo GraphQL server.

### [/graff/](/graff/) - **Graff**
The knowledge graph. This is a graphql server meant to provide internal read/writable access to known truth for safe network clients. Prisma managed RDS database.

### [/nexus/](/nexus/) - **Nexus**
The hub of all networks. Guarddog and pathfinder, a graphql federation server that assembles and protects a singular exposed supergraph.

### [/sam/](/sam/) - **SAM**
Secure, Assure, Mitigate. Natural language interface for the network, providing wake word functionality, authentication, and managed access to the network.

### [/viola/](/viola/) - **Viola**
The improvisation engine. While SAM is capable of responding to user-triggered requests, Viola is a neural-network-driven daemon, actively seeking possible actions.

## You find a Map:

![Infrastructure Map](https://g.gravizo.com/source/custom_mark21)
