-- CreateTable
CREATE TABLE "Group" (
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "iconUrl" TEXT,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("groupId")
);

-- CreateTable
CREATE TABLE "UserGroup" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("userId","groupId")
);
