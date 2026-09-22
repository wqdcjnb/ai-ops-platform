# Project-managed services

The root Compose file starts four application services together:

- `cpa`: CLIProxyAPI, with `config.yaml`, `.env`, `auths/`, logs, plugins and static assets mounted from `deploy/cpa/`.
- `new-api`: New API in the existing SQLite mode, with its database and logs mounted from `deploy/new-api/`.
- `server` and `web`: AI OPS.

The current machine's CPA config/auths and New API SQLite database are migrated here locally. These runtime files are ignored by Git. CPA client and management credentials are read by the AI OPS server from the mounted project config files; they are not copied into the source code or Docker image.

For a fresh installation, copy the two example files to `config.yaml` and `.env`, replace their placeholders, and put CPA authentication JSON files under `auths/`. The New API request/management token, if AI OPS is required to read protected New API catalog endpoints, belongs only in the ignored root `.env` as `NEW_API_ACCESS_TOKEN` or `AI_OPS_GATEWAY_NEW_API_API_KEY`.
