-- CreateTable
CREATE TABLE "UserGroupInvitation" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "UserGroupInvitation_pkey" PRIMARY KEY ("userId","groupId")
);
