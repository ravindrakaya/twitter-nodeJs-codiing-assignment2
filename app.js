const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

// API 1 Register the user in Twitter Account
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectQuery = `SELECT * FROM user WHERE username = "${username}";`;
  const dbUser = await db.get(selectQuery);
  //console.log(dbUser);
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const createUserQuery = `INSERT INTO user
                                (username, password, name, gender)
                                VALUES (
                                    "${username}",
                                    "${hashedPassword}",
                                    "${name}",
                                    "${gender}"
                                );`;
      await db.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2 Log in to Certain Account
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectQuery = `SELECT * FROM user WHERE username = "${username}";`;
  const dbUser = await db.get(selectQuery);
  //console.log(dbUser);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    //console.log(isPasswordMatched);
    if (isPasswordMatched) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// Authentication with JWT Token
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeaders = request.headers["authorization"];
  //console.log(authHeaders);
  if (authHeaders !== undefined) {
    jwtToken = authHeaders.split(" ")[1];
    //console.log(jwtToken);
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

// API 3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const getLatestTweetQuery = `SELECT 
                                        user.name AS  username,
                                        t.tweet AS tweet,
                                        t.date_time AS dateTime
                                    FROM (follower 
                                    INNER JOIN tweet 
                                    ON follower.following_user_id = tweet.user_id) AS t 
                                    INNER JOIN user ON t.user_id = user.user_id
                                    ORDER BY tweet.date_time DESC
                                    LIMIT 4;`;
  const latestTweets = await db.all(getLatestTweetQuery);
  response.send(latestTweets);
});

// API 4
app.get("/user/following/", authenticateToken, async (request, response) => {
  const followingUsersQuery = `SELECT user.name AS name FROM user INNER JOIN follower
                                    ON follower.following_user_id = user.user_id;`;
  const followingUsers = await db.all(followingUsersQuery);
  response.send(followingUsers);
});

// API 5
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const userFollowerQuery = `SELECT user.name AS name FROM user INNER JOIN follower
                                    ON follower.follower_user_id = user.user_id;`;
  const userFollows = await db.all(userFollowerQuery);
  response.send(userFollows);
});

// API 6
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const userFollowingTweetIdQuery = `SELECT t.tweet_id  FROM (follower INNER JOIN tweet
                                            ON tweet.user_id = follower.following_user_id ) as t
                                            WHERE tweet_id = ${tweetId}
                                        ;`;

  const userFollowingTweetId = await db.get(userFollowingTweetIdQuery);
  //console.log(userFollowingTweetId);
  if (userFollowingTweetId === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    // console.log(userFollowingTweetId);
    const resultQuery = `SELECT tweet,
                            (SELECT COUNT(*) FROM like WHERE tweet_id = ${tweetId}) AS likes,
                            (SELECT COUNT(*) FROM reply WHERE tweet_id = ${tweetId}) AS replies,
                            date_time AS dateTime FROM tweet 
                            WHERE tweet_id = ${tweetId};`;
    const result = await db.get(resultQuery);
    // console.log(result);
    response.send(result);
  }
});

// API 7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userFollowingTweetIdQuery = `SELECT t.tweet_id FROM (follower INNER JOIN tweet
                                ON follower.following_user_id = tweet.user_id) AS t
                                WHERE tweet_id = ${tweetId};`;
    const userFollowingTweetId = await db.get(userFollowingTweetIdQuery);
    //console.log(userFollowingTweetId);
    if (userFollowingTweetId === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getLikeUsersQuery = `SELECT T.username  FROM (user INNER JOIN like
                                ON user.user_id = like.user_id) AS T
                                WHERE tweet_id = ${tweetId};`;
      const likedUsers = await db.all(getLikeUsersQuery);
      //console.log(likedUsers);
      const usersArray = likedUsers.map((eachUser) => eachUser.username);
      //console.log(usersArray);
      response.send({
        likes: usersArray,
      });
    }
  }
);

// API 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userFollowingTweetIdQuery = `SELECT t.tweet_id FROM (follower INNER JOIN tweet
                                ON follower.following_user_id = tweet.user_id) AS t
                                WHERE tweet_id = ${tweetId};`;
    const userFollowingTweetId = await db.get(userFollowingTweetIdQuery);
    //console.log(userFollowingTweetId);
    if (userFollowingTweetId === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getReplayQuery = `SELECT T.name, T.reply FROM (reply INNER JOIN user
                                ON reply.user_id = user.user_id) AS T
                                WHERE tweet_id = ${tweetId};`;
      const replayUsers = await db.all(getReplayQuery);
      response.send({
        replies: replayUsers,
      });
    }
  }
);

// API 9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const listOfTweetQuery = `SELECT 
                                            T.tweet,
                                            COUNT(DISTINCT like_id) AS likes,
                                            COUNT(DISTINCT reply_id) AS replies,
                                            date_time AS dateTime
                                     FROM (tweet INNER JOIN reply
                                    ON tweet.tweet_id = reply.tweet_id) AS T
                                    INNER JOIN like ON T.tweet_id = like.tweet_id;`;
  const tweetList = await db.all(listOfTweetQuery);
  response.send(tweetList);
});
// API 10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;

  const postQuery = `INSERT INTO tweet
                        (tweet)
                        VALUES ("${tweet}");`;
  await db.run(postQuery);
  response.send("Created a Tweet");
});
// API 11
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { userId } = request;
    const { tweetId } = request.params;
    const getTweetQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId};`;
    const tweet = await db.get(getTweetQuery);
    //console.log(tweet);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
      db.run(deleteQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
