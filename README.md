# Alignment

Alignment presents Alef conversations and pooled SDLC data as composable Workspaces for human review and decision-making.

## Layout

```text
alignment/
├── apps/
│   └── alignment/       React application
├── packages/            shared packages when independent reuse is proven
└── prototypes/          isolated compatibility experiments
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev --workspace=@alignment/app
npm run test:e2e --workspace=@alignment/app
```

The application reads Alef's local session store through a development-server adapter. Browser code receives opaque conversation identifiers and normalized events; it does not receive filesystem paths.
