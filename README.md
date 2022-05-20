# Aubron's Personal Infrastructure Monorepo

This repository contains a monorepo of the critical infrastructure powering SAM, a natural language life management engine designed to operate as a security system, task and queue management tool, and smarthome platform.

## The path diverges ahead:

The infrastructure is broken into microservices, which roughly map to directories in this folder:

### Implemented

#### [/graff/](/graff/) - **Graff**
The knowledge graph. This is a graphql server meant to provide internal read/writable access to known truth for safe network clients. Prisma managed PlanetScale database.

#### [/nexus/](/nexus/) - **Nexus**
The hub of all networks. Guarddog and pathfinder, a graphql federation server that assembles and protects a singular exposed supergraph. Apollo Gateway running on Elastic Beanstalk

### Unimplemented (Planned)

#### [/sam/](/sam/) - **SAM**
Secure, Assure, Mitigate. Natural language interface for the network, providing wake word functionality, authentication, and managed access to the network.

#### [/viola/](/viola/) - **Viola**
The improvisation engine. While SAM is capable of responding to user-triggered requests, Viola is a neural-network-driven daemon, actively seeking possible actions. Pulls double duty by generating unknown intent responses, where improvisation is needed.

#### [/waystone/](/waystone/) - **Waystones**
The bridge to reality. A microservice run at all local sites, meant to bridge local network access and expose the real world to the network. Apollo GraphQL server.

## You find a Map:

```mermaid
flowchart TD
  subgraph Local Device
    SAM{{SAM Client}}
  end
  subgraph Cloud Services
    Graff{{Graff<br>-Apollo-}}
    Viola{{Viola}}
    Nexus{{Nexus<br>-Apollo Gateway-}}
    CloudTTS[[Cloud Wavenet Synthesis]]
    CloudNL[[Cloud Natural Language]]
    Planetscale[[Planetscale Database]]
  end
  subgraph On Prem Site
    Waystone{{Waystone<br>-Apollo-}} --> localDevices((Various Local Devices<br>State, Interaction))
  end
    SAM --GraphQL --> Nexus
    SAM <--Websocket Audio--> Nexus
    Nexus --Apollo Federation--> Graff --Generated Prisma Client--> Planetscale
    Nexus --Apollo Federation--> Waystone
    Nexus --Speech Synthesis--> CloudTTS 
    Nexus --Unknown Intent Extraction-->CloudNL
    Nexus --Improvise Failures --> Viola
    Viola <--Improvisation Synthesis-->CloudTTS
    CloudNL <--Improvise Contextually--> Viola
    Viola --> OpenAI[[OpenAI API]]
```
