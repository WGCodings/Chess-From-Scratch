# Contributing to Chess From Scratch

Thanks for trying Chess From Scratch! Feedback from people building their
first engine is the most useful thing there is right now.

## Feedback: open an issue

Go to [Issues](https://github.com/WGCodings/Chess-From-Scratch/issues) and click
**New issue**. A few lines are enough:

- **Something broke?** What you did, what you expected, what happened. A
  screenshot helps. If it is about your engine, attach your `.cfs` file (Save in
  the app) so the problem can be reproduced.
- **An idea?** What you want to do and why. Ideas for new blocks are very welcome.
- **Confused by something?** That is a bug in the guide or the app. Tell us
  where you got stuck.

## Pull requests

1. Open an issue first for anything bigger than a small fix, so we can agree on
   the approach.
2. Fork the repository and make your change on a branch.
3. Run the checks:

   ```sh
   npm ci
   npm test                                   # unit tests
   npm run check:generated -w @cfs/codegen    # every engine setup compiles (needs Rust)
   npm run e2e -w @cfs/web                    # the editor in Chrome
   ```

4. Open the pull request with a short description of what changed and why.

How the code is organised and how the generator works: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

New built-in blocks need a region in `packages/codegen/templates/`, an entry in
`packages/codegen/src/blocks.ts`, and must keep the reference engine's `bench`
node count unless they are meant to change it.

## Licensing of contributions

The app is licensed under the AGPL-3.0, and the Rust templates and example
blocks under MIT (see the README). By opening a pull request you agree that
your contribution is licensed the same way, and that the maintainer may also
offer it under other licenses later (for example a commercial license of the
app). If that does not work for you, say so in the pull request before it is merged.
