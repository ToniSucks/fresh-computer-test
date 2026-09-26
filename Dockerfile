FROM node:20

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install dependencies (including native modules like better-sqlite3)
RUN npm install

# Bundle app source
COPY . .

# Expose the port your app runs on
EXPOSE 3000

# Command to run the application
CMD [ "npm", "start" ]
