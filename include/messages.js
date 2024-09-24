const moment = require("moment");

function formatMessage(username, text, imageUrl = null) {
  return {
    username,
    text,
      imageUrl, 
    time: moment().format("h:mm a"),
  };
}

module.exports = formatMessage;
