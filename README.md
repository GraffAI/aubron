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

![Alt text](https://g.gravizo.com/source/svg/custom_mark10?https%3A%2F%2Fraw.githubusercontent.com%2FGraffAI%2Faubron%2Fmain%2FREADME.md)
<details> 
<summary></summary>
custom_mark10
digraph G {

  subgraph cluster_0 {
    style=filled;
    color=lightgrey;
    node [style=filled,color=white];
    Waystone0;
    Waystone1;
    label = "Local Sites";
  }

  subgraph cluster_1 {
    style=filled;
    color=lightgrey;
    node [style=filled,color=white];
    Graff;
    Nexus;
    label = "AWS Services";
  }
  

  SAM -> Nexus, Viola;
  SAM -> CloudTTS [label="Speech Synthesis"];
  CloudTTS -> CloudAI [label="Unknown intent extraction"];
  CloudTTS -> Viola [label="Improvise failed response"];
  Viola -> OpenAI [label="Text generation"]
  SAM -> Picovoice [label="Wake word, Known intents"];
  Nexus -> Graff [label="Prisma Client"];
  Nexus -> Waystone0, Waystone1 [label="Apollo Federation"];
  Viola -> SAM [label="Preemptive actions"];
  

  SAM [shape=Square];
  CloudTTS [label="Cloud Wavenet"];
  Picovoice;
  CloudSpeech [label="Cloud Speech-to-Text"];
  CloudAI [label="Cloud Natural Language"];
  OpenAI;
  Nexus;
  Viola;
  Waystone0 [label="Waystone (Shop)"];
  Waystone1 [label="Waystone (Home)"];
  Graff;
}
custom_mark10
</details>
