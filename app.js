const express = require("express");
const sqlite3 = require("sqlite3");
const path = require("path");
const format = require("date-fns/format");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { open } = require("sqlite");
let db = null;
const dbPath = path.join(__dirname, "todoApplication.db");

const app = express();
app.use(express.json());

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at https://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const secret = "PRIVATE_KEY";

const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, secret, async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//POST: register user

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `
  SELECT * 
  FROM user 
  WHERE username='${username}
  '`;
  const dbUser = await db.get(selectUserQuery);
  if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    if (dbUser === undefined) {
      const createUserQuery = `
      INSERT INTO 
      USER (username, password, name, gender)
      VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}')
      `;
      const dbResponse = await db.run(createUserQuery);
      console.log(dbResponse.lastId);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("User already exists");
    }
  }
});

//POST: login user

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
  SELECT * 
  FROM user 
  WHERE username='${username}
  '`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, secret);
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//GET tweets

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getLoggedInUserIdQuery = `
  SELECT user_id
  FROM user 
  WHERE username="${username}"
  `;
  const dbUser = await db.get(getLoggedInUserIdQuery);
  const userId = dbUser.user_id;

  const getTweetsQuery = `
    SELECT user.username, 
    tweet.tweet, 
    tweet.date_time
    FROM 
    (follower JOIN tweet on follower.following_user_id=tweet.user_id) AS T
    JOIN user ON follower.following_user_id=user.user_id 
    WHERE follower.follower_user_id=${userId}
    ORDER BY tweet.date_time
    LIMIT 4
    `;
  const dbResponse = await db.all(getTweetsQuery);
  const responseData = dbResponse.map((res) => ({
    username: res.username,
    tweet: res.tweet,
    dateTime: res.date_time,
  }));
  response.send(responseData);
});

//GET user following list

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getLoggedInUserIdQuery = `
  SELECT user_id
  FROM user 
  WHERE username="${username}"
  `;
  const dbUser = await db.get(getLoggedInUserIdQuery);
  const userId = dbUser.user_id;

  const getUserFollowingQuery = `
  SELECT user.username
  FROM follower JOIN user ON follower.following_user_id=user.user_id
  WHERE follower.follower_user_id=${userId};
  `;
  const dbResponse = await db.all(getUserFollowingQuery);
  const responseData = dbResponse.map((res) => ({ name: res.username }));
  response.send(responseData);
});

//GET user followers list

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getLoggedInUserIdQuery = `
  SELECT user_id
  FROM user 
  WHERE username="${username}"
  `;
  const dbUser = await db.get(getLoggedInUserIdQuery);
  const userId = dbUser.user_id;

  const getUserFollowersQuery = `
  SELECT user.username
  FROM 
  follower JOIN user ON follower.follower_user_id=user.user_id
  WHERE follower.following_user_id=${userId};
  `;
  const dbResponse = await db.all(getUserFollowersQuery);
  const responseData = dbResponse.map((res) => ({ name: res.username }));
  response.send(responseData);
});

//GET tweet

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getLoggedInUserIdQuery = `
  SELECT user_id
  FROM user 
  WHERE username="${username}"
  `;
  const dbUser = await db.get(getLoggedInUserIdQuery);
  const userId = dbUser.user_id;

  const { tweetId } = request.params;
  const getTweetForUser = `
  SELECT tweet.tweet,
  COUNT(DISTINCT like.like_id) AS likes,
  COUNT(DISTINCT reply.reply_id) AS replies,
  tweet.date_time
  FROM 
  (((tweet JOIN like ON tweet.tweet_id=like.tweet_id) AS T
  JOIN reply ON reply.tweet_id=tweet.tweet_id) AS U
  JOIN user ON user.user_id=tweet.user_id) AS V
  JOIN follower ON follower.following_user_id=user.user_id
  WHERE tweet.tweet_id=${tweetId}
  GROUP BY tweet.tweet_id
  HAVING follower.follower_user_id=${userId}
  `;
  const dbResponse = await db.get(getTweetForUser);
  if (dbResponse === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const responseData = {
      tweet: dbResponse.tweet,
      likes: dbResponse.likes,
      replies: dbResponse.replies,
      dateTime: dbResponse.date_time,
    };
    response.send(responseData);
  }
});

//GET list of liked users

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const getLoggedInUserIdQuery = `
  SELECT user_id
  FROM user 
  WHERE username="${username}"
  `;
    const dbUser = await db.get(getLoggedInUserIdQuery);
    const userId = dbUser.user_id;

    const { tweetId } = request.params;
    const getLikedUsersQuery = `
  SELECT DISTINCT user.username
  FROM 
  tweet JOIN like ON tweet.tweet_id=like.tweet_id
  JOIN user ON like.user_id=user.user_id
  JOIN follower ON user.user_id=follower.following_user_id
  WHERE tweet.tweet_id=${tweetId}
  AND follower.follower_user_id=${userId}
  `;
    const dbResponse = await db.all(getLikedUsersQuery);
    if (dbResponse.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const likedUsersList = dbResponse.map((res) => res.username);
      const responseData = { likes: likedUsersList };
      response.send(responseData);
    }
  }
);

//GET replies

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const getLoggedInUserIdQuery = `
  SELECT user_id
  FROM user 
  WHERE username="${username}"
  `;
    const dbUser = await db.get(getLoggedInUserIdQuery);
    const userId = dbUser.user_id;

    const { tweetId } = request.params;
    const getRepliesQuery = `
  SELECT DISTINCT user.username,
  reply.reply
  FROM 
  tweet JOIN reply ON tweet.tweet_id=reply.tweet_id
  JOIN user ON reply.user_id=user.user_id
  JOIN follower ON user.user_id=follower.following_user_id
  WHERE tweet.tweet_id=${tweetId}
  AND follower.follower_user_id=${userId}
  `;
    const dbResponse = await db.all(getRepliesQuery);
    if (dbResponse.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const responseData = dbResponse.map((res) => ({
        name: res.username,
        reply: res.reply,
      }));
      response.send(responseData);
    }
  }
);

//GET user tweets

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getLoggedInUserIdQuery = `
    SELECT user_id
    FROM user 
    WHERE username="${username}"
    `;
  const dbUser = await db.get(getLoggedInUserIdQuery);
  const userId = dbUser.user_id;

  const getUserTweetsQuery = `
    SELECT tweet.tweet,
    COUNT(DISTINCT like.like_id) AS likes,
    COUNT(DISTINCT reply.reply_id) AS replies,
    tweet.date_time
    FROM 
    tweet JOIN like on tweet.tweet_id=like.tweet_id
    JOIN reply on reply.tweet_id=tweet.tweet_id
    WHERE tweet.user_id=${userId}
    GROUP BY tweet.tweet_id
    `;
  const dbResponse = await db.all(getUserTweetsQuery);
  const responseData = dbResponse.map((res) => ({
    tweet: res.tweet,
    likes: res.likes,
    replies: res.replies,
    dateTime: res.date_time,
  }));

  response.send(responseData);
});

//POST tweet

app.post("/user/tweets", authenticateToken, async (request, response) => {
  const { username } = request;
  const getLoggedInUserIdQuery = `
    SELECT user_id
    FROM user 
    WHERE username="${username}"
    `;
  const dbUser = await db.get(getLoggedInUserIdQuery);
  const userId = dbUser.user_id;
  const { tweet } = request.body;
  const dateTime = format(new Date(), "MM-dd-yyyy HH:mm:ss");

  const postTweetQuery = `
  INSERT INTO tweet (tweet, user_id, date_time)
  VALUES ('${tweet}', '${userId}', '${dateTime}')
  `;
  const dbResponse = await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

//DELETE tweet

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const getLoggedInUserIdQuery = `
    SELECT user_id
    FROM user 
    WHERE username="${username}"
    `;
    const dbUser = await db.get(getLoggedInUserIdQuery);
    const userId = dbUser.user_id;

    const { tweetId } = request.params;
    const deleteTweetQuery = `
    DELETE from tweet 
    WHERE tweet_id=${tweetId}
    AND user_id=${userId}
    `;
    const dbResponse = await db.run(deleteTweetQuery);
    if (dbResponse.changes === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
