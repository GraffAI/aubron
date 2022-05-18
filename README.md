# Aubron's Personal Infrastructure Monorepo

This repository contains a monorepo of the critical infrastructure powering SAM, a natural language life management engine designed to operate as a security system, task and queue management tool, and smarthome platform.

## The path diverges ahead:

The infrastructure is broken into microservices, which roughly map to directories in this folder:

### [/graff/](/graff/) - **Graff** - Unimplemented
The knowledge graph. This is a graphql server meant to provide internal read/writable access to known truth for safe network clients. Prisma managed RDS database.

### [/nexus/](/nexus/) - **Nexus** - Unimplemented
The hub of all networks. Guarddog and pathfinder, a graphql federation server that assembles and protects a singular exposed supergraph.

### [/sam/](/sam/) - **SAM** - Unimplemented
Secure, Assure, Mitigate. Natural language interface for the network, providing wake word functionality, authentication, and managed access to the network.

### [/viola/](/viola/) - **Viola** - Unimplemented
The improvisation engine. While SAM is capable of responding to user-triggered requests, Viola is a neural-network-driven daemon, actively seeking possible actions.

### [/waystone/](/waystone/) - **Waystones** - Unimplemented
The bridge to reality. A microservice run at all local sites, meant to bridge local network access and expose the real world to the network. Apollo GraphQL server.

## You find a Map:

```mermaid
flowchart TD
  subgraph Local Device
    SAM{{SAM Client}}
  end
  subgraph Cloud Services
    Graff{{Graff}}
    Viola{{Viola}}
    Nexus{{Nexus}}
    CloudTTS[[Cloud Wavenet Synthesis]]
    CloudNL[[Cloud Natural Language]]
  end
  subgraph On Prem Site
    Waystone{{Waystone}} --> localDevices((Various Local Devices<br>State, Interaction))
  end
    SAM --GraphQL Queries--> Nexus
    Nexus --GraphQL/Prisma--> Graff
    Nexus --Apollo Federation--> Waystone
    Nexus --Speech Synthesis--> CloudTTS 
    Nexus --Unknown Intent Extraction-->CloudNL
    Nexus --Improvise Failures --> Viola
    Viola <--Improvisation Synthesis-->CloudTTS
    CloudNL --Improvise Contextually--> Viola
    Viola --> OpenAI[[OpenAI API]]
```
