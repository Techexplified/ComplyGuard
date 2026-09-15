import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

const prisma = global.prismaGlobal ?? new PrismaClient();

global.prismaGlobal = prisma;

export default prisma;
