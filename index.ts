import { Server, Socket } from 'socket.io'
import * as dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { DefaultEventsMap } from 'socket.io/dist/typed-events'
import { nanoid } from 'nanoid'
import express from 'express'
import bodyParser from 'body-parser'
import http from 'http'
import morgan from 'morgan'
import { Profanity, ProfanityOptions } from '@2toad/profanity'
import badWords from './badWords.json'

interface IClientData {
    userId: string
    name: string
    connectionKey: string
}

dotenv.config()
const prisma = new PrismaClient()
const app = express()
const server = http.createServer(app)
const io = new Server(server)
const connectingUsers: { [id: string]: IClientData } = {}
const connections: { [id: string]: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData> } = {}
const connectionsByName: { [name: string]: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData> } = {}
const connectionsByGroupId: { [groupId: string]: { [id: string]: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData> } } = {}
const profanityOptions = new ProfanityOptions()
profanityOptions.wholeWord = false
profanityOptions.grawlix = "*****"
const profanity = new Profanity(profanityOptions)
profanity.addWords(badWords)

app.use(morgan('combined'))
app.use(bodyParser.json())

async function GroupLeave(groupId: string | undefined, userId: string | undefined) {
    // Validate group
    if (!groupId) {
        return
    }
    // Validate user
    if (!userId) {
        return
    }
    // Delete user's group data from database
    await prisma.userGroup.deleteMany({
        where: {
            userId: userId,
            groupId: groupId,
        }
    })
    // Valiate before send group moving message to clients
    if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, groupId)) {
        return
    }
    if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[groupId], userId)) {
        return
    }
    // Remove user from the group
    await NotifyGroup(userId)
    delete connectionsByGroupId[groupId][userId]
    // Broadcast leave member
    const targetClients = connectionsByGroupId[groupId]
    for (const targetUserId in targetClients) {
        const targetClient = targetClients[targetUserId]
        targetClient.emit("group-leave", {
            groupId: groupId,
        })
    }
}

async function NotifyGroupInvitation(userId: string) {
    const list = await prisma.userGroupInvitation.findMany({
        where: {
            userId: userId,
        }
    })
    const groupIds: Array<string> = []
    list.forEach(element => {
        groupIds.push(element.groupId)
    })
    const groupList = await prisma.group.findMany({
        where: {
            groupId: {
                in: groupIds
            }
        }
    })
    if (Object.prototype.hasOwnProperty.call(connections, userId)) {
        const socket = connections[userId]
        socket.emit("group-invitation-list", {
            list: groupList
        })
    }
}

async function NotifyGroupUser(userId: string, groupId: string) {
    const list = await prisma.userGroup.findMany({
        where: {
            groupId: groupId,
        }
    })
    const userIds: Array<string> = []
    list.forEach(element => {
        userIds.push(element.userId)
    })
    const userList = await prisma.user.findMany({
        where: {
            userId: {
                in: userIds
            }
        }
    })
    
    if (Object.prototype.hasOwnProperty.call(connections, userId)) {
        const socket = connections[userId]
        socket.emit("group-user-list", {
            groupId: groupId,
            list: userList
        })
    }
}

async function NotifyGroup(userId: string) {
    const list = await prisma.userGroup.findMany({
        where: {
            userId: userId,
        }
    })
    const groupIds: Array<string> = []
    list.forEach(element => {
        groupIds.push(element.groupId)
    })
    const groupList = await prisma.group.findMany({
        where: {
            groupId: {
                in: groupIds
            }
        }
    })
    if (Object.prototype.hasOwnProperty.call(connections, userId)) {
        const socket = connections[userId]
        socket.emit("group-list", {
            list: groupList
        })
    }
}

async function AddUserToGroup(userId: string, groupId: string) {
    await prisma.userGroup.deleteMany({
        where: {
            userId: userId,
            groupId: groupId,
        }
    })
    await prisma.userGroup.create({
        data: {
            userId: userId,
            groupId: groupId,
        }
    })
    if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, groupId)) {
        connectionsByGroupId[groupId] = {}
    }
    // Add user to group
    if (Object.prototype.hasOwnProperty.call(connections, userId)) {
        const socket = connections[userId]
        connectionsByGroupId[groupId][userId] = socket
    }
    // Broadcast new member
    const targetClients = connectionsByGroupId[groupId]
    for (const targetUserId in targetClients) {
        const targetClient = targetClients[targetUserId]
        targetClient.emit("group-join", {
            "groupId": groupId,
            "userId": targetClient.data.userId,
            "name": targetClient.data.name,
        })
    }
    await NotifyGroupInvitation(userId)
    await NotifyGroup(userId)
}

io.on("connection", async (socket: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData>) => {
    socket.on("validate-user", async (data) => {
        const userId = data.userId
        console.log("Connecting by [" + socket.id + "] user ID [" + userId + "]")
        if (!userId) {
            socket.disconnect(true)
            console.log("Not allow [" + socket.id + "] to connect because it has invalid user ID")
            return
        }
        // If the client is not allowed, disconnect
        if (!Object.prototype.hasOwnProperty.call(connectingUsers, userId)) {
            socket.disconnect(true)
            console.log("Not allow [" + socket.id + "] to connect because it has invalid user ID")
            return
        }

        // Validate connection key
        const connectingUser = connectingUsers[userId]
        const connectionKey = data.connectionKey
        if (connectionKey != connectingUser.connectionKey) {
            socket.disconnect(true)
            console.log("Not allow [" + socket.id + "] to connect because it has invalid connection key")
            return
        }

        // Disconnect older socket
        if (Object.prototype.hasOwnProperty.call(connections, userId)) {
            connections[userId].disconnect(true);
            console.log("Disconnect [" + connections[userId].id + "] because it is going to connect by newer client with the same user ID")
        }

        // Set user data after connected
        socket.data = connectingUser

        // Set socket client to the collections
        connections[userId] = socket
        connectionsByName[connectingUser.name] = socket

        // Find and store user groups
        const userGroups = await prisma.userGroup.findMany({
            where: {
                userId: userId
            }
        })
        userGroups.forEach(userGroup => {
            if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, userGroup.groupId)) {
                connectionsByGroupId[userGroup.groupId] = {}
            }
            connectionsByGroupId[userGroup.groupId][userId] = socket
        })
        await NotifyGroup(userId)
    })

    socket.on("local", (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        for (const targetUserId in connections) {
            const targetClient = connections[targetUserId]
            targetClient.emit("local", {
                "userId": userId,
                "name": socket.data.name,
                "msg": profanity.censor(data.msg),
                "map": data.map,
                "x": data.x,
                "y": data.y,
                "z": data.z,
            })
        }
    })

    socket.on("global", (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        for (const targetUserId in connections) {
            const targetClient = connections[targetUserId]
            targetClient.emit("global", {
                "userId": userId,
                "name": socket.data.name,
                "msg": profanity.censor(data.msg),
            })
        }
    })

    socket.on("whisper", (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        const targetName = data.targetName
        if (!Object.prototype.hasOwnProperty.call(connectionsByName, targetName)) {
            return
        }
        const targetClient = connectionsByName[targetName]
        targetClient.emit("whisper", {
            "userId": userId,
            "userId2": targetClient.data.userId,
            "name": socket.data.name,
            "name2": targetClient.data.name,
            "msg": profanity.censor(data.msg),
        })
        socket.emit("whisper", {
            "userId": userId,
            "userId2": targetClient.data.userId,
            "name": socket.data.name,
            "name2": targetClient.data.name,
            "msg": profanity.censor(data.msg),
        })
    })

    socket.on("group", (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        const groupId = data.groupId
        if (!groupId) {
            return
        }
        // Has the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, groupId)) {
            return
        }
        // User is in the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[groupId], userId)) {
            return
        }
        const targetClients = connectionsByGroupId[groupId]
        for (const targetUserId in targetClients) {
            const targetClient = targetClients[targetUserId]
            targetClient.emit("group", {
                "groupId": groupId,
                "userId": userId,
                "name": socket.data.name,
                "msg": profanity.censor(data.msg),
            })
        }
    })

    socket.on("create-group", async (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        const groupId = nanoid(8)
        const title = data.title
        const iconUrl = data.iconUrl
        // Insert group data to database
        await prisma.group.create({
            data: {
                groupId: groupId,
                title: title,
                iconUrl: iconUrl,
            }
        })
        // Add user to the group
        await prisma.userGroup.deleteMany({
            where: {
                userId: userId,
                groupId: groupId,
            }
        })
        await prisma.userGroup.create({
            data: {
                userId: userId,
                groupId: groupId,
            }
        })
        connectionsByGroupId[groupId] = {}
        connectionsByGroupId[groupId][userId] = socket
        // Tell the client that the group was created
        socket.emit("create-group", {
            "groupId": groupId,
            "title": title,
            "iconUrl": iconUrl,
        })
    })

    socket.on("update-group", async (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        const groupId = data.groupId
        if (!groupId) {
            return
        }
        // Has the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, groupId)) {
            return
        }
        // User is in the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[groupId], userId)) {
            return
        }
        // Update group data at database
        const title = data.title
        const iconUrl = data.iconUrl
        await prisma.group.update({
            where: {
                groupId: groupId,
            },
            data: {
                title: title,
                iconUrl: iconUrl
            },
        })
        // Tell the clients that the group was updated
        const targetClients = connectionsByGroupId[groupId]
        for (const targetUserId in targetClients) {
            const targetClient = targetClients[targetUserId]
            targetClient.emit("update-group", {
                "groupId": groupId,
                "title": title,
                "iconUrl": iconUrl,
            })
        }
    })

    socket.on("group-invitation-list", async (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        await NotifyGroupInvitation(userId)
    })

    socket.on("group-user-list", async (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        const groupId = data.groupId
        if (!groupId) {
            return
        }
        await NotifyGroupUser(userId, groupId)
    })

    socket.on("group-list", async (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        await NotifyGroup(userId)
    })

    socket.on("group-invite", async (data) => {
        const inviteId = socket.data.userId
        if (!inviteId) {
            return
        }
        const userId = data.userId
        if (!userId) {
            return
        }
        const groupId = data.groupId
        if (!groupId) {
            return
        }
        // Has the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, groupId)) {
            return
        }
        // Inviter is in the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[groupId], inviteId)) {
            return
        }
        let mode : Number = 0
        if (process.env.GROUP_USER_ADD_MODE) {
            mode = Number(process.env.GROUP_USER_ADD_MODE)
        }
        if (mode == 0) {
            // Create invitation
            await prisma.userGroupInvitation.deleteMany({
                where: {
                    userId: userId,
                    groupId: groupId,
                }
            })
            await prisma.userGroupInvitation.create({
                data: {
                    userId: userId,
                    groupId: groupId,
                }
            })
            await NotifyGroupInvitation(userId)
        } else {
            await AddUserToGroup(userId, groupId)
        }
    })

    socket.on("group-invite-accept", async (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        const groupId = data.groupId
        if (!groupId) {
            return
        }
        // Validate invitation
        const countInvitation = await prisma.userGroupInvitation.count({
            where: {
                userId: userId,
                groupId: groupId,
            }
        })
        if (countInvitation == 0) {
            return
        }
        // Delete invitation
        await prisma.userGroupInvitation.deleteMany({
            where: {
                userId: userId,
                groupId: groupId,
            }
        })
        // Add user to the group
        AddUserToGroup(userId, groupId)
    })

    socket.on("group-invite-decline", async (data) => {
        const userId = socket.data.userId
        if (!userId) {
            return
        }
        const groupId = data.groupId
        if (!groupId) {
            return
        }
        // Validate invitation
        const countInvitation = await prisma.userGroupInvitation.count({
            where: {
                userId: userId,
                groupId: groupId,
            }
        })
        if (countInvitation == 0) {
            return
        }
        // Delete invitation
        await prisma.userGroupInvitation.deleteMany({
            where: {
                userId: userId,
                groupId: groupId,
            }
        })
        await NotifyGroupInvitation(userId)
    })

    socket.on("leave-group", (data) => {
        const groupId = data.groupId
        GroupLeave(groupId, socket.data.userId)
    })

    socket.on("kick-user", (data) => {
        const groupId = data.groupId
        GroupLeave(groupId, data.userId)
    })
})

app.post('/add-user', async (req, res) => {
    // This must be able to connect by game-server only, don't allow client to connect
    // Validate connection by secret key which will be included in header -> authorization
    // TODO: Implements middleware if there are more than 1 function which will validate authorization like this
    const bearerHeader = req.headers['authorization']
    if (!bearerHeader) {
        res.sendStatus(400)
        return
    }
    // Substring `bearer `, length is 7
    const bearerToken = bearerHeader.substring(7)
    const secretKeys: string[] = JSON.parse(process.env.SECRET_KEYS || "[]")
    if (secretKeys.indexOf(bearerToken) < 0) {
        res.sendStatus(400)
        return
    }
    // Token is correct, then create user connection data
    const connectingUser = {
        userId: req.body.userId,
        name: req.body.name,
        connectionKey: nanoid(6),
    } as IClientData
    connectingUsers[connectingUser.userId] = connectingUser
    const user = await prisma.user.findUnique({
        where: {
            userId: req.body.userId,
        }
    })
    if (user) {
        await prisma.user.update({
            where: {
                userId: req.body.userId,
            },
            data: {
                name: req.body.name,
                iconUrl: req.body.iconUrl,
            }
        })
    } else {
        await prisma.user.create({
            data: {
                userId: req.body.userId,
                name: req.body.name,
                iconUrl: req.body.iconUrl,
            }
        })
    }
    // Send response back
    res.status(200).send(connectingUser)
})

const port = Number(process.env.SERVER_PORT || 8215)
server.listen(port, () => {
    console.log("Simple chat server listening on :" + port)
})