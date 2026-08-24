# Pins the exact rendering environment workspace-visual.spec.ts's own
# baselines are generated and compared against -- the documented standard
# fix for cross-machine Playwright screenshot flake (see that spec file's
# own comment, and task "Fix Zodiac's visual-regression test setup").
# Playwright's docs: "Screenshots differ between browsers and platforms due
# to different rendering, fonts and more" -- baselines generated ad hoc on
# whatever machine last ran --update-snapshots (this repo's prior state,
# confirmed: no Dockerfile existed anywhere) are the textbook version of
# that exact problem.
#
# Tag pinned to this repo's own installed @playwright/test version
# (apps/web/package.json) -- keep these in lockstep; a version drift here
# reintroduces the identical cross-environment mismatch this file exists
# to prevent, just against the container instead of another machine.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /repo

# node-pty (apps/terminal, unused by these tests but still installed --
# npm workspaces installs every workspace's own dependencies from the
# root) needs a real native build toolchain to compile against this image's
# own Node headers.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 && rm -rf /var/lib/apt/lists/*

# The whole monorepo, not just manifests: apps/terminal/package.json
# depends on a local vendor/*.tgz file dependency that must physically
# exist at `npm ci` time, so a manifests-only COPY layer (better build
# caching) doesn't work here -- correctness over layer-cache efficiency
# for what's a one-off verification tool, not a hot CI path.
COPY . .
RUN npm ci
RUN npm run build --workspace=@zodiac/service

WORKDIR /repo/apps/web

ENTRYPOINT ["npx", "playwright", "test"]
CMD ["workspace-visual", "--reporter=list"]
