FROM node:alpine

WORKDIR /usr/src/app

ARG DEMO_API_PORT

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE ${DEMO_API_PORT}

CMD ["npm", "run", "start"]