"use strict";
const logger = require("../../logwrapper");
const profileManager = require("../../common/profile-manager");
const { Worker } = require("worker_threads");
const frontendCommunicator = require("../../common/frontend-communicator");
const rolesManager = require("../../roles/custom-roles-manager");
const permitCommand = require("./url-permit-command");

let getChatModerationSettingsDb = () => profileManager.getJsonDbInProfile("/chat/moderation/chat-moderation-settings");
let getBannedWordsDb = () => profileManager.getJsonDbInProfile("/chat/moderation/banned-words", false);

// default settings
let chatModerationSettings = {
    bannedWordList: {
        enabled: false
    },
    emoteLimit: {
        enabled: false,
        max: 10
    },
    urlModeration: {
        enabled: false,
        viewTime: {
            enabled: false,
            viewTimeInHours: 0
        },
        outputMessage: ""
    },
    exemptRoles: []
};

let bannedWords = {
    words: []
};

function getBannedWordsList() {
    if (!bannedWords || !bannedWords.words) return [];
    return bannedWords.words.map(w => w.text);
}

/**
 * @type Worker
 */
let moderationService = null;

function startModerationService() {
    if (moderationService != null) return;

    const chat = require("../twitch-chat");

    let servicePath = require("path").resolve(__dirname, "./moderation-service.js");

    if (servicePath.includes("app.asar")) {
        servicePath = servicePath.replace('app.asar', 'app.asar.unpacked');
    }

    moderationService = new Worker(servicePath);

    moderationService.on("message", event => {
        if (event == null) return;
        switch (event.type) {
        case "deleteMessage": {
            if (event.messageId) {
                logger.debug(`Chat message with id '${event.messageId}' contains a banned word. Deleting...`);
                chat.deleteMessage(event.messageId);
            }
            break;
        }
        }
    });

    moderationService.on("error", code => {
        logger.warn(`Moderation worker failed with code: ${code}.`);
        moderationService.unref();
        moderationService = null;
        //startModerationService();
    });

    moderationService.on("exit", code => {
        logger.debug(`Moderation service stopped with code: ${code}.`);
    });

    moderationService.postMessage(
        {
            type: "bannedWordsUpdate",
            words: getBannedWordsList()
        }
    );

    logger.info("Finished setting up chat moderation worker.");
}

function stopService() {
    if (moderationService != null) {
        moderationService.terminate();
        moderationService.unref();
        moderationService = null;
    }
}

const countEmojis = (str) => {
    const re = /\p{Extended_Pictographic}/ug; //eslint-disable-line
    return ((str || '').match(re) || []).length;
};

/**
 *
 * @param {import("../chat-helpers").FirebotChatMessage} chatMessage
 */
async function moderateMessage(chatMessage) {
    if (chatMessage == null) return;

    if (
        !chatModerationSettings.bannedWordList.enabled
        && !chatModerationSettings.emoteLimit.enabled
        && !chatModerationSettings.urlModeration.enabled
    ) return;

    let moderateMessage = false;

    const userExempt = rolesManager.userIsInRole(chatMessage.username, chatMessage.roles,
        chatModerationSettings.exemptRoles);

    if (!userExempt) {
        moderateMessage = true;
    }

    if (moderateMessage) {
        const chat = require("../twitch-chat");

        if (chatModerationSettings.emoteLimit.enabled && !!chatModerationSettings.emoteLimit.max) {
            const emoteCount = chatMessage.parts.filter(p => p.type === "emote").length;
            const emojiCount = chatMessage.parts
                .filter(p => p.type === "text")
                .reduce((acc, part) => acc + countEmojis(part.text), 0);
            if ((emoteCount + emojiCount) > chatModerationSettings.emoteLimit.max) {
                chat.deleteMessage(chatMessage.id);
                return;
            }
        }

        if (chatModerationSettings.urlModeration.enabled) {
            if (permitCommand.hasTemporaryPermission(chatMessage.username)) return;

            const message = chatMessage.rawText;
            const regex = new RegExp(/[\w]{2,}[.][\w]{2,}/, "gi");

            if (!regex.test(message)) return;

            logger.debug("Url moderation: Found url in message...");

            const settings = chatModerationSettings.urlModeration;
            let outputMessage = settings.outputMessage || "";

            if (settings.viewTime && settings.viewTime.enabled) {
                const viewerDB = require('../../database/userDatabase');
                const viewer = await viewerDB.getUserByUsername(chatMessage.username);

                const viewerViewTime = viewer.minutesInChannel / 60;
                const minimumViewTime = settings.viewTime.viewTimeInHours;

                if (viewerViewTime >= minimumViewTime) return;

                outputMessage = outputMessage.replace("{viewTime}", minimumViewTime.toString());

                logger.debug("Url moderation: Not enough view time.");
            } else {
                logger.debug("Url moderation: User does not have exempt role.");
            }

            chat.deleteMessage(chatMessage.id);

            if (outputMessage) {
                outputMessage = outputMessage.replace("{userName}", chatMessage.username);
                chat.sendChatMessage(outputMessage);
            }
        }

        const message = chatMessage.rawText;
        const messageId = chatMessage.id;
        moderationService.postMessage(
            {
                type: "moderateMessage",
                message: message,
                messageId: messageId,
                scanForBannedWords: chatModerationSettings.bannedWordList.enabled,
                maxEmotes: null
            }
        );
    }
}

frontendCommunicator.on("chatMessageSettingsUpdate", settings => {
    chatModerationSettings = settings;
    try {
        getChatModerationSettingsDb().push("/", settings);
    } catch (error) {
        if (error.name === 'DatabaseError') {
            logger.error("Error saving chat moderation settings", error);
        }
    }
});

function saveBannedWordList() {
    try {
        getBannedWordsDb().push("/", bannedWords);
    } catch (error) {
        if (error.name === 'DatabaseError') {
            logger.error("Error saving banned words data", error);
        }
    }
    if (moderationService != null) {
        moderationService.postMessage(
            {
                type: "bannedWordsUpdate",
                words: getBannedWordsList()
            }
        );
    }
}

frontendCommunicator.on("addBannedWords", words => {
    bannedWords.words = bannedWords.words.concat(words);
    saveBannedWordList();
});

frontendCommunicator.on("removeBannedWord", wordText => {
    bannedWords.words = bannedWords.words.filter(w => w.text.toLowerCase() !== wordText);
    saveBannedWordList();
});

frontendCommunicator.on("removeAllBannedWords", () => {
    bannedWords.words = [];
    saveBannedWordList();
});

frontendCommunicator.on("getChatModerationData", () => {
    return {
        settings: chatModerationSettings,
        bannedWords: bannedWords.words
    };
});

function load() {
    try {
        let settings = getChatModerationSettingsDb().getData("/");
        if (settings && Object.keys(settings).length > 0) {
            chatModerationSettings = settings;
            if (settings.exemptRoles == null) {
                settings.exemptRoles = [];
            }
            if (settings.emoteLimit == null) {
                settings.emoteLimit = { enabled: false, max: 10 };
            }

            if (settings.urlModeration == null) {
                settings.urlModeration = {
                    enabled: false,
                    viewTime: {
                        enabled: false,
                        viewTimeInHours: 0
                    },
                    outputMessage: ""
                };
            }

            if (settings.urlModeration.enabled) {
                permitCommand.registerPermitCommand();
            }
        }

        let words = getBannedWordsDb().getData("/");
        if (words && Object.keys(words).length > 0) {
            bannedWords = words;
        }
    } catch (error) {
        if (error.name === 'DatabaseError') {
            logger.error("Error loading chat moderation data", error);
        }
    }
    logger.info("Attempting to setup chat moderation worker...");
    startModerationService();
}
exports.load = load;
exports.stopService = stopService;
exports.moderateMessage = moderateMessage;