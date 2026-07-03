# CODEX.md

# J.A.R.V.I.S. - Project Context for Codex

## Project Vision

J.A.R.V.I.S. (Just A Rather Very Intelligent System) is **not a chatbot**.

The goal of this repository is to build a long-term AI Operating System inspired by J.A.R.V.I.S. from Iron Man.

The system should eventually become a central platform capable of orchestrating multiple AI agents, workflows, tools and external services through a single intelligent interface.

The frontend already provides a cinematic HUD experience. The backend should evolve into a scalable AI platform rather than a traditional REST application.

---

# Mission

The purpose of this project is to build an ecosystem where specialized AI agents cooperate under one intelligent core.

The long-term architecture should support:

- Multiple specialized AI agents
- Agent orchestration
- Shared memory
- Workflow execution
- External integrations
- Automation
- Plugin system
- Knowledge base
- Long-term scalability

The current implementation should focus only on the next logical step while preserving this long-term vision.

---

# Architectural Philosophy

Think about this project as an operating system.

NOT as a chatbot.

NOT as a CRUD application.

NOT as a single AI assistant.

The frontend is the user interface.

The backend is the operating system.

Agents are workers.

The Orchestrator is the coordinator.

Tools provide capabilities.

Memory stores knowledge.

Every component should have one clear responsibility.

---

# Development Philosophy

The project is intentionally developed in small iterations.

Avoid overengineering.

Avoid unnecessary abstraction.

Avoid creating infrastructure that is not yet needed.

However...

Never introduce architectural decisions that make future evolution difficult.

The preferred approach is:

> Simple today.
>
> Scalable tomorrow.

---

# Current Technology Stack

Current technologies include:

- React 19
- TanStack Start
- TypeScript
- TailwindCSS
- Supabase
- PostgreSQL
- FastAPI
- Python
- Gemini

These technologies may evolve over time.

Codex may suggest improvements if they provide clear architectural advantages.

---

# Backend Direction

The backend should evolve as a **modular monolith**.

Do NOT design microservices unless there is a compelling reason.

Modules should be independent and loosely coupled.

Typical domains may include:

- Core
- API
- Agents
- Tasks
- Memory
- Tools
- Services
- Orchestrator
- Scheduler
- Plugins

This list is not fixed.

Codex may propose a better organization when appropriate.

---

# AI Agents

Agents are not prompts.

Agents are software components.

Every agent should eventually have:

- identity
- role
- capabilities
- tools
- permissions
- memory
- configuration
- lifecycle
- metrics
- health status

Avoid hardcoded behavior.

Prefer extensible designs.

The first agents are expected to become reusable building blocks for future agents.

---

# Orchestrator

The Orchestrator is expected to become the heart of the system.

Responsibilities:

- coordinate agents
- distribute work
- monitor execution
- manage workflows
- schedule tasks

The Orchestrator should NOT contain business logic that belongs inside agents.

Agents execute.

The Orchestrator coordinates.

---

# Memory

Memory should evolve gradually.

Initial implementations may be simple.

Long-term vision includes:

- Working Memory
- Conversation Memory
- Long-Term Memory
- Structured Knowledge
- Vector Memory

Current implementations should leave room for future expansion.

---

# Database Philosophy

Design the database with future growth in mind.

Do not create unnecessary tables only because they may become useful.

However...

Relationships, naming and structure should naturally support future evolution.

Whenever proposing schema changes:

- explain the reasoning
- explain tradeoffs
- avoid unnecessary complexity
- avoid breaking extensibility

---

# Coding Principles

Always prefer:

- readability
- maintainability
- modularity
- explicit naming
- clean interfaces
- composition over duplication
- single responsibility

Avoid:

- magic values
- hidden side effects
- tightly coupled code
- unnecessary complexity

Code should be understandable by another developer without additional explanation.

---

# Decision Making

Whenever multiple solutions exist:

1. Prefer long-term maintainability.
2. Prefer scalability.
3. Prefer modularity.
4. Explain tradeoffs.
5. Challenge existing assumptions if a significantly better solution exists.

Do not blindly preserve existing code if it limits future development.

---

# Communication

When proposing architectural decisions:

Explain WHY.

Not only WHAT.

When proposing improvements:

Include advantages.

Include disadvantages.

Explain long-term consequences.

Do not optimize only for today's requirements.

---

# Frontend Philosophy

The frontend already provides a premium cinematic experience.

Future backend development should respect the existing UI architecture.

Business logic belongs in the backend.

Presentation belongs in the frontend.

Avoid leaking backend implementation details into the UI.

---

# Long-Term Features

The platform is expected to support, over time:

- Multi-agent collaboration
- Autonomous agents
- Planning
- Workflow engine
- Shared memory
- Plugin system
- Tool registry
- External APIs
- GitHub integration
- File analysis
- Smart Home integration
- Monitoring
- Notifications
- Multiple LLM providers
- Voice interaction
- AI-powered automation

These features should emerge naturally through iterative development.

Do not build them prematurely.

---

# What Success Looks Like

The goal is NOT to build software quickly.

The goal is to build a platform that can evolve for many years without requiring architectural rewrites.

Every architectural decision should answer one question:

> "Will this still be a good decision when J.A.R.V.I.S. manages 100+ specialized agents?"

If the answer is "no", reconsider the design.

---

# Codex Role

You are not only writing code.

You are acting as a senior software architect working on a long-term AI platform.

When appropriate:

- suggest architectural improvements
- identify technical debt
- recommend better abstractions
- keep the codebase consistent
- think ahead
- avoid unnecessary complexity
- preserve flexibility

Feel free to challenge existing implementations when a better solution exists.

The objective is not to preserve today's architecture.

The objective is to continuously improve it without breaking the long-term vision.

---

# Final Principle

Build foundations.

Not shortcuts.

Every module should make adding the next module easier.

Every agent should make creating the next agent simpler.

Every decision should move the platform closer to becoming a true AI Operating System.