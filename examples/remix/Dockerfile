FROM node:lts-alpine as base
ENV NODE_ENV production

# Stage 1: Install all node_modules, including dev dependencies
FROM base as deps
WORKDIR /remix-app
COPY package.json ./
RUN npm install --include=dev

# Stage 2: Setup production node_modules
FROM base as production-deps
WORKDIR /remix-app
COPY --from=deps /remix-app/node_modules /remix-app/node_modules
COPY package.json ./
RUN npm prune --omit=dev

# Stage 3: Build the app
FROM base as build
WORKDIR /remix-app
COPY --from=deps /remix-app/node_modules /remix-app/node_modules
COPY . .
RUN npm run build

# Stage 4: Build the production image
FROM base
WORKDIR /remix-app
COPY --from=production-deps /remix-app/node_modules /remix-app/node_modules
COPY --from=build /remix-app/build /remix-app/build
COPY --from=build /remix-app/public /remix-app/public
COPY package.json ./

CMD ["npm", "start"]