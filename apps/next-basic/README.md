# Tileflow Next Basic Demo

Next.js App Router demo using `@tileflow/core`, `@tileflow/react`, and
`@tileflow/next`.

```sh
pnpm dev:next-basic
```

The demo serves local Tileflow assets at `/tileflow/*` through a development
rewrite to `app/api/tileflow/[[...tileflow]]/route.ts`. `next build` emits
matching static artifacts into `public/tileflow`.
