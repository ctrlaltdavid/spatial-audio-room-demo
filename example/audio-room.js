//
//  Created by Ken Cooke on 3/11/22.
//  Copyright 2022 High Fidelity, Inc.
//
//  The contents of this file are PROPRIETARY AND CONFIDENTIAL, and may not be
//  used, disclosed to third parties, copied or duplicated in any form, in whole
//  or in part, without the prior written consent of High Fidelity, Inc.
//

'use strict';

import * as HiFiAudio from './hifi-audio.js'
import { TransportManagerP2P } from "./hifi-transport-p2p.js";
import { TransportManagerAgora } from "./hifi-transport-agora.js";

import { CanvasControl } from './canvas-control.js'

function degToRad(d) {
    return Math.PI * d / 180.0;
}

let options = {};
let canvasControl;
let elements = [];
let listenerUid;
let usernames = {};
let joined = false;
let localSourcesEnabled = true;

// characterPosition x and y are floats [0.0, 1.0)
let characterPosition = {
    x: 0.5 * Math.random(),
    y: 0.5 * Math.random(),
    o: 0.0
};
let characterPositionSet = false;


function getCharacterPositionX() {
    let ropts = roomOptions[ currentRoomID ];
    let canvasDimensions = ropts.canvasDimensions;
    let minX = -canvasDimensions.width / 2;
    let maxX = canvasDimensions.width / 2;
    return (maxX - minX) * characterPosition.x + minX;
}

function setCharacterPositionX(x) {
    let ropts = roomOptions[ currentRoomID ];
    let canvasDimensions = ropts.canvasDimensions;
    let minX = -canvasDimensions.width / 2;
    let maxX = canvasDimensions.width / 2;
    characterPosition.x = (x - minX) / (maxX - minX);
}

function getCharacterPositionY() {
    let ropts = roomOptions[ currentRoomID ];
    let canvasDimensions = ropts.canvasDimensions;
    let minY = -canvasDimensions.height / 2;
    let maxY = canvasDimensions.height / 2;
    return (maxY - minY) * characterPosition.y + minY;
}

function setCharacterPositionY(y) {
    let ropts = roomOptions[ currentRoomID ];
    let canvasDimensions = ropts.canvasDimensions;
    let minY = -canvasDimensions.height / 2;
    let maxY = canvasDimensions.height / 2;
    characterPosition.y = (y - minY) / (maxY - minY);
}


function getCharacterPositionInAudioSpace() {
    return {
        x: getCharacterPositionX(),
        y: getCharacterPositionY(),
        z: 0,
        o: characterPosition.o
    };
}

function setCharacterPositionFromAudioSpace(p) {
    setCharacterPositionX(p.x);
    setCharacterPositionY(p.y);
    characterPosition.o = p.o;
}


const roomOptions = {
    "room-conf-table": {
        video: false,
        metaData: true,
        positions: [
            { x: 0, y: -1, o: degToRad(0) },
            { x: 1, y: 0, o: degToRad(270) },
            { x: 0, y: 1, o: degToRad(180) },
            { x: -1, y: 0, o: degToRad(90) },
            { x: -0.707, y: -0.707, o: degToRad(45) },
            { x: -0.707, y: 0.707, o: degToRad(135) },
            { x: 0.707, y: 0.707, o: degToRad(225) },
            { x: 0.707, y: -0.707, o: degToRad(315) }
        ],
        canvasDimensions: { width: 4, height: 4 },
        background: "Table_semi-transparent_HF_Logo.svg",
        localAudioSources: [
            { x: -1.6, y: -1.6, url: "sounds/campfire.wav" },
            { x: -1.6, y:  1.6, url: "sounds/owl.wav" },
            { x:  1.6, y:  1.6, url: "sounds/waterfall.wav" },
            { x:  1.6, y: -1.6, url: "sounds/thunder.wav" }
        ]
    },

    "room-quad-music": {
        video: false,
        metaData: true,
        positions: [],
        canvasDimensions: { width: 8, height: 8 },
        background: "Semi-transparent_HF_Logo.svg",
        localAudioSources: []
    },

    "room-bar": {
        video: false,
        metaData: true,
        positions: [],
        canvasDimensions: { width: 16, height: 16 },
        background: "Semi-transparent_HF_Logo.svg",
        localAudioSources: []
    },

    "room-video": {
        video: true,
        metaData: false,
        positions: [],
        canvasDimensions: { width: 8, height: 8 },
        background: "Semi-transparent_HF_Logo.svg",
        localAudioSources: []
    }
}


let roomIDs = [];
for (const [key, value] of Object.entries(roomOptions)) {
    roomIDs.push(key);
}
let currentRoomID = roomIDs[0];
let serverCurrentRoomID = roomIDs[0];

let localAudioSourceIDs = {};


// assume token server is on same webserver as this app...
let tokenURL = new URL(window.location.href)
let pathParts = tokenURL.pathname.split("/");
tokenURL.pathname = "/token-server";
tokenURL.protocol = "wss";

let demoGroupName = null;
if (pathParts.length > 1) {
    demoGroupName = pathParts[ 1 ];
} else {
    demoGroupName = "hifi-demo";
}


//
// Sortable layout of video elements
//
let sortable;
let resizeObserver;


function readyVideoSortable() {
    if (sortable) {
        return;
    }

    sortable = Sortable.create(playerlist, {
        sort: true,
        direction: "horizontal",
        onChange: updateVideoPositions,  // update positions on drag-and-drop
    });
    resizeObserver = new ResizeObserver(updateVideoPositions);
    resizeObserver.observe(playerlist); // update positions on resize
}


let webSocket = new WebSocket(tokenURL.href);
webSocket.onmessage = async function (event) {
    // console.log("got websocket message: ", event.data);
    let msg = JSON.parse(event.data);
    if (msg.room) {
        serverCurrentRoomID = msg.room;
    } else {
        serverCurrentRoomID = currentRoomID;
    }
    if (msg["message-type"] == "join-room" && !joined) {
        currentRoomID = serverCurrentRoomID;
        if (!characterPositionSet) {
            let nth = msg["nth"];
            let ropts = roomOptions[ currentRoomID ];
            let positions = ropts.positions;
            if (nth < positions.length) {
                setOwnPosition(positions[ nth ]);
                characterPositionSet = true;
            }
        }
    }
}

webSocket.onopen = async function (event) {
    options.channel = await getRoomNamePrefix();
    getCurrentRoom();
    updateRoomsUI();
}


// the demo can auto-set channel and user-name with params in url
$(()=>{
    let urlParams = new URL(location.href).searchParams;
    options.channel = ""
    options.username = urlParams.get("username");
    $("#username").val(options.username);

    for (const rID of roomIDs) {
        let roomButton = document.getElementById(rID);
        roomButton.style.background="#D9E8EF";
    }
}
)

$("#username").change(function (e) {
    options.username = $("#username").val();
    $("#local-player-name").text(options.username);

    // if already connected, update my name
    setUsername(options.username)
})

$("#join-form").submit(async function(e) {
    $("#leave").attr("disabled", true);
    $("#join").attr("disabled", true);
    e.preventDefault();
    await joinRoom();
})

$("#leave").click(async function(e) {
    $("#leave").attr("disabled", true);
    $("#join").attr("disabled", true);
    await leaveRoom(false);
})


$("#aec").click(async function(e) {
    // toggle the state
    await HiFiAudio.setAecEnabled(!HiFiAudio.isAecEnabled());
    updateAudioControlsUI();
    let ropts = roomOptions[ currentRoomID ];
    if (ropts.video) {
        await HiFiAudio.playVideo(listenerUid, "local-player");
    }
})


$("#local").click(async function(e) {
    if (localSourcesEnabled) {
        await stopLocalSources();
        localSourcesEnabled = false;
    } else {
        await startLocalSources();
        localSourcesEnabled = true;
    }
    updateAudioControlsUI();
})



$("#mute").click(function(e) {
    // toggle the state
    HiFiAudio.setMutedEnabled(!HiFiAudio.isMutedEnabled());
    updateAudioControlsUI();
    // if muted, set gate threshold to 0dB, else follow slider
    HiFiAudio.setThreshold(HiFiAudio.isMutedEnabled() ? 0.0 : threshold.value);
})

// $("#sound").click(async function(e) {
//     let audioData = await fetch('https://raw.githubusercontent.com/kencooke/spatial-audio-room/master/sound.wav');
//     let audioBuffer = await audioData.arrayBuffer();
//     HiFiAudio.playSoundEffect(audioBuffer, false);
// })



for (const rID of roomIDs) {
    $("#" + rID).click(async function(e) {
        // if (HiFiAudio.isChrome()) {
            if (joined) {
                await leaveRoom(true);
                currentRoomID = serverCurrentRoomID;
            }
        // } else {
        //     if (joined) {
        //         return;
        //     }
        // }

        currentRoomID = rID;
        await joinRoom();
    })
}


// threshold slider
threshold.oninput = () => {
    HiFiAudio.setThreshold(threshold.value);
    document.getElementById("threshold-value").value = threshold.value;
}

function clampCharacterPosition() {
    let ropts = roomOptions[ currentRoomID ];
    let canvasDimensions = ropts.canvasDimensions;
    let minX = -canvasDimensions.width / 2;
    let minY = -canvasDimensions.height / 2;
    let maxX = canvasDimensions.width / 2;
    let maxY = canvasDimensions.height / 2;

    if (getCharacterPositionX() < minX) setCharacterPositionX(minX);
    if (getCharacterPositionY() < minY) setCharacterPositionY(minY);
    if (getCharacterPositionX() > maxX) setCharacterPositionX(maxX);
    if (getCharacterPositionY() > maxY) setCharacterPositionY(maxY);
}


// called when the user drags around dots on the canvas
function updatePositions(elts) {

    let ropts = roomOptions[ currentRoomID ];

    for (let e of elts) {
        // transform from canvas to audio coordinates
        let x = (e.x - 0.5) * ropts.canvasDimensions.width;
        let y = -(e.y - 0.5) * ropts.canvasDimensions.height;

        if (e.uid === listenerUid) {
            setCharacterPositionX(x);
            setCharacterPositionY(y);
            characterPosition.o = e.o;
            clampCharacterPosition();
            HiFiAudio.setListenerPosition(getCharacterPositionInAudioSpace());
        } else if (e.clickable) {
            HiFiAudio.setSourcePosition(e.uid, x, y);
        }
    }
}


function updateVideoPositions() {
    readyVideoSortable();
    let order = sortable.toArray();

    // compute horizontal bounds
    let xmin = 999999;
    let xmax = 0;
    order.forEach((uid, i) => {
        let rect = sortable.el.children[i].getClientRects();
        if (rect && rect[0]) {
            xmin = Math.min(xmin, rect[0].left);
            xmax = Math.max(xmax, rect[0].right);
        }
    });

    // center the horizontal axis at zero
    let xoff = (xmin + xmax) / 2;
    xmin -= xoff;
    xmax -= xoff;

    // compute azimuth from center of video element
    order.forEach((uid, i) => {
        let rect = sortable.el.children[i].getClientRects();
        if (rect && rect[0]) {
            let x = (rect[0].left + rect[0].right) / 2 - xoff;
            let azimuth = (Math.PI / 2) * (x / xmax);   // linear, not atan(x)

            // update hifiSource
            HiFiAudio.setPolarSourcePosition(uid, azimuth, 1.0);
            console.log("Set uid =", uid, "to azimuth =", (azimuth * 180) / Math.PI);
        }
    });
}


function updateRemotePosition(uid, x, y, o) {
    // update canvas position
    let e = elements.find(e => e.uid === uid);
    if (e !== undefined) {
        let ropts = roomOptions[ currentRoomID ];
        e.x = 0.5 + (x / ropts.canvasDimensions.width);
        e.y = 0.5 - (y / ropts.canvasDimensions.height);
        e.o = o;
    }
}


function updateVolumeIndicator(uid, level) {
    let e = elements.find(e => e.uid === uid);
    if (e !== undefined)
        e.radius = 0.02 + 0.04 * level/100;
}


function receiveBroadcast(uid, data) {
    // console.log('%creceived stream-message from:', 'color:cyan', usernames[uid]);

    let txt = (new TextDecoder).decode(data);
    let msg = JSON.parse(txt);

    switch(msg.type) {

    case "username": {
        usernames[uid] = msg.username;
        let ropts = roomOptions[ currentRoomID ];
        if (ropts.video) {
            if (!usernames[uid] || usernames[uid] == "") {
                $(`#player-name-${uid}`).text("-");
            } else {
                $(`#player-name-${uid}`).text(usernames[uid]);
            }
        }
        break;
    }

    default:
        console.log("WARNING -- unknown broadcast message type: " + txt);
    }
}


function onUserPublished(uid) {

    let ropts = roomOptions[ currentRoomID ];
    if (ropts.video) {
        const player = $(`
        <div id="player-wrapper-${uid}" data-id="${uid}" class="player-wrapper">
            <div id="player-${uid}" class="player"></div>
            <p id="player-name-${uid}" class="player-name"></p>
        </div>
        `);

        $("#playerlist").append(player);
        if (!usernames[uid] || usernames[uid] == "") {
            $(`#player-name-${uid}`).text("-");
        } else {
            $(`#player-name-${uid}`).text(usernames[uid]);
        }
        HiFiAudio.playVideo(uid, `player-${uid}`);
        updateVideoPositions();
    } else {
        elements.push({
            icon: 'sourceIcon',
            radius: 0.02,
            alpha: 0.5,
            clickable: false,
            uid,
        });
    }

    sendUsername();
}


function onUserUnpublished(uid) {

    $(`#player-wrapper-${uid}`).remove();

    let ropts = roomOptions[ currentRoomID ];
    if (ropts.video) {
        if (sortable) {
            updateVideoPositions();
        }
    } else {
        // find and remove this uid
        let i = elements.findIndex(e => e.uid === uid);
        elements.splice(i, 1);

        delete localAudioSourceIDs[ uid ];
    }
}


async function getRoomNamePrefix() {
    var resolve, reject;

    const crPromise = new Promise((setResolve, setReject) => {
        resolve = setResolve;
        reject = setReject;
    });

    var previousOnMessage = webSocket.onmessage;
    webSocket.onmessage = function (event) {
        // console.log("got websocket response: ", event.data);
        previousOnMessage(event);
        let msg = JSON.parse(event.data);
        if (msg["message-type"] == "set-channel-prefix") {
            webSocket.onmessage = previousOnMessage;
            resolve(msg["channel-prefix"]);
        }
    }

    webSocket.send(JSON.stringify({
        "message-type": "get-channel-prefix",
        "demo-group-name": demoGroupName
    }));

    return crPromise;
}


async function getCurrentRoom() {
    var resolve, reject;

    const crPromise = new Promise((setResolve, setReject) => {
        resolve = setResolve;
        reject = setReject;
    });

    var previousOnMessage = webSocket.onmessage;
    webSocket.onmessage = function (event) {
        // console.log("got websocket response: ", event.data);
        previousOnMessage(event);
        let msg = JSON.parse(event.data);
        if (msg["message-type"] == "join-room") {
            webSocket.onmessage = previousOnMessage;
            resolve(currentRoomID);
        }
    }

    webSocket.send(JSON.stringify({
        "message-type": "get-current-room"
    }));

    return crPromise;
}


// https://docs.agora.io/en/Interactive%20Broadcast/token_server
async function fetchToken(uid /*: string */, channelName /*: string */, tokenRole /*: number */) {

    var resolve, reject;

    const tokenPromise = new Promise((setResolve, setReject) => {
        resolve = setResolve;
        reject = setReject;
    });

    var previousOnMessage = webSocket.onmessage;
    webSocket.onmessage = function (event) {
        // console.log("got websocket response: ", event.data);
        let msg = JSON.parse(event.data);
        if (msg["message-type"] == "new-agora-token") {
            webSocket.onmessage = previousOnMessage;
            resolve(msg["token"]);
        } else {
            previousOnMessage(event);
        }
    }

    webSocket.send(JSON.stringify({
        "message-type": "get-agora-token",
        "uid": uid,
        "agora-channel-name": channelName,
        "token-role": tokenRole
    }));

    return tokenPromise;
}


async function joinRoom() {
    options.appid = $("#appid").val();
    options.token = $("#token").val();
    options.username = $("#username").val();

    HiFiAudio.on("remote-position-updated", updateRemotePosition);
    HiFiAudio.on("broadcast-received", receiveBroadcast);
    HiFiAudio.on("remote-volume-updated", updateVolumeIndicator);
    HiFiAudio.on("remote-source-connected", onUserPublished);
    HiFiAudio.on("remote-source-disconnected", onUserUnpublished);

    if (!HiFiAudio.isChrome()) {
        HiFiAudio.setAecEnabled(true);
    }

    if (!serverCurrentRoomID) {
        serverCurrentRoomID = roomIDs[0];
    }

    if (!currentRoomID) {
        currentRoomID = serverCurrentRoomID;
    }

    let ropts = roomOptions[ currentRoomID ];

    clampCharacterPosition();

    let transport;
    if (true) {
        transport = new TransportManagerAgora(options.appid, fetchToken) /* as TransportManager */;
    } else {
        let signalingURL = new URL(window.location.href)
        signalingURL.pathname = "/token-server";
        signalingURL.protocol = "wss";
        transport = new TransportManagerP2P(signalingURL) /* as TransportManager */;
    }

    listenerUid = transport.generateUniqueID();

    await HiFiAudio.join(transport,
                         listenerUid,
                         options.channel + ":" + currentRoomID,
                         getCharacterPositionInAudioSpace(),
                         threshold.value,
                         ropts.video,
                         ropts.metaData);

    joined = true;
    usernames[ listenerUid ] = options.username;

    if (ropts.video) {
        if (!options.username || options.username == "") {
            $("#local-player-name").text("-");
        } else {
            $("#local-player-name").text(options.username);
        }
        readyVideoSortable();
        // Play the local video track
        HiFiAudio.playVideo(listenerUid, "local-player");
    } else {
        sortable = null;
        resizeObserver = null;

        //
        // canvas GUI
        //
        let canvas = document.getElementById('canvas');

        elements.push({
            icon: 'listenerIcon',
            x: 0.5 + (getCharacterPositionX() / ropts.canvasDimensions.width),
            y: 0.5 - (getCharacterPositionY() / ropts.canvasDimensions.height),
            o: characterPosition.o,
            radius: 0.02,
            alpha: 0.5,
            clickable: true,
            uid: listenerUid
        });

        canvasControl = new CanvasControl(canvas, elements, usernames, updatePositions, ropts.background);
        canvasControl.draw();
    }

    if (localSourcesEnabled) {
        startLocalSources();
    }

    updateAudioControlsUI();
    updateRoomsUI();
    sendUsername();
}


async function leaveRoom(willRestart) {
    await HiFiAudio.leave(willRestart);

    // remove remote users and player views
    $("#remote-playerlist").html("");
    $("#local-player-name").text("-");

    elements.length = 0;
    joined = false;
    currentRoomID = serverCurrentRoomID;
    updateRoomsUI();
    console.log("client leaves channel success");
}


function sendUsername() {
    if (!usernames[listenerUid]) {
        return;
    }

    // broadcast my name
    let msg = {
        type: "username",
        username: usernames[listenerUid]
    };
    HiFiAudio.sendBroadcastMessage((new TextEncoder).encode(JSON.stringify(msg)));
}


function setUsername(username) {
    usernames[listenerUid] = username;
    if (joined) {
        sendUsername();
    }
}


function updateAudioControlsUI() {
    $("#aec").css("background-color", HiFiAudio.isAecEnabled() ? "purple" : "");
    $("#aec").prop('checked', HiFiAudio.isAecEnabled());

    $("#local").css("background-color", localSourcesEnabled ? "purple" : "");
    $("#local").prop('checked', localSourcesEnabled);

    $("#mute").css("background-color", HiFiAudio.isMutedEnabled() ? "purple" : "");
    $("#mute").prop('checked', HiFiAudio.isMutedEnabled());
}


function updateRoomsUI() {
    for (const rID of roomIDs) {
        let roomButton = document.getElementById(rID);
        if (rID == currentRoomID && joined) {
            roomButton.style.background="#007bff";
        } else {
            roomButton.style.background="#D9E8EF";
        }
    }

    let canvasContainer = document.getElementById("canvas-container");
    let videoroomContainer = document.getElementById("playerlist");

    if (currentRoomID) {
        let ropts = roomOptions[ currentRoomID ];
        if (ropts.video) {
            canvasContainer.style.display = "none";
            videoroomContainer.style.display = "block";
        } else {
            canvasContainer.style.display = "block";
            videoroomContainer.style.display = "none";
        }
    }

    if (joined) {
        $("#leave").attr("disabled", false);
    } else {
        $("#leave").attr("disabled", true);
    }

    if (webSocket.readyState === WebSocket.OPEN) {
        // if (HiFiAudio.isChrome()) {
            setRoomButtonsEnabled(true);
        // } else {
        //     setRoomButtonsEnabled(!joined);
        // }
        if (joined) {
            $("#join").attr("disabled", true);
        } else {
            $("#join").attr("disabled", false);
        }
    } else {
        $("#join").attr("disabled", true);
        setRoomButtonsEnabled(false);
    }
}


function setRoomButtonsEnabled(v) {
    for (const rID of roomIDs) {
        let roomButton = document.getElementById(rID);
        roomButton.disabled = !v;
    }
}


function setOwnPosition(p) {
    console.log("SET OWN POSITION: " + JSON.stringify(p));
    setCharacterPositionFromAudioSpace(p);

    let e = elements.find(e => e.uid === listenerUid);
    if (e !== undefined) {
        let ropts = roomOptions[ currentRoomID ];
        e.x = 0.5 + (p.x / ropts.canvasDimensions.width);
        e.y = 0.5 - (p.y / ropts.canvasDimensions.height);
        e.o = p.o;
    }
    updatePositions(elements);
}


async function startLocalSound(url, x, y) {

    // load the audio file
    let response = await fetch(url);
    let buffer = await response.arrayBuffer();

    let sourceUID = await HiFiAudio.addLocalAudioSource(buffer, true);
    HiFiAudio.setSourcePosition(sourceUID, x, y);

    // add GUI element
    let ropts = roomOptions[ currentRoomID ];
    elements.push({
        icon: 'soundIcon',
        x: 0.5 + (x / ropts.canvasDimensions.width),
        y: 0.5 - (y / ropts.canvasDimensions.height),
        o: 0.0,
        radius: 0.02,
        alpha: 0.5,
        clickable: true,
        uid: sourceUID
    });

    usernames[sourceUID] = url.substring(url.lastIndexOf("/")+1, url.lastIndexOf("."));
    console.log('Started local sound:', url);

    return sourceUID;
}


async function startLocalSources() {
    let ropts = roomOptions[ currentRoomID ];
    for (let src of ropts.localAudioSources) {
        let localSourceUID = await startLocalSound(src.url, src.x, src.y);
        console.log("starting local source id=" + localSourceUID + " url=" + src.url);
        localAudioSourceIDs[ localSourceUID ] = true;
    }
}


async function stopLocalSources() {
    for (let localSourceUID in localAudioSourceIDs) {
        console.log("stopping local source id=" + localSourceUID);
        HiFiAudio.stopAudioSource(localSourceUID);
    }
}
