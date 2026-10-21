import {
  randEmail,
  randFullName,
  randLines,
  randParagraph,
  randPassword, randPhrase,
  randWord
} from '@ngneat/falso';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { RegisteredUser } from '../app/routes/auth/registered-user.model';
import { createUser } from '../app/routes/auth/auth.service';
import { addComment, createArticle } from '../app/routes/article/article.service';

const prisma = new PrismaClient();

// Titles and usernames must be unique, and falso's phrases and names repeat: add a short random suffix.
const suffix = () => randomUUID().slice(0, 8);

export const generateUser = async (): Promise<RegisteredUser> =>
  createUser({
    username: `${randFullName()} ${suffix()}`,
    email: randEmail(),
    password: randPassword(),
    image: 'https://api.realworld.io/images/demo-avatar.png',
    demo: true,
  });

export const generateArticle = async (id: number) =>
  createArticle(
    {
      title: `${randPhrase()} ${suffix()}`,
      description: randParagraph(),
      body: randLines({ length: 10 }).join(' '),
      // Unique within the article: a repeated tag would hit the Tag name unique constraint.
      tagList: [...new Set(randWord({ length: 4 }))],
    },
    id,
  );

export const generateComment = async (id: number, slug: string) =>
  addComment(randParagraph(), slug, id);

const main = async () => {
  try {
    const users = await Promise.all(Array.from({length: 12}, () => generateUser()));
    users?.map(user => user);

    // eslint-disable-next-line no-restricted-syntax
    for await (const user of users) {
      // One at a time: articles created in parallel race to create the same new tag (unique constraint).
      const articles = [];
      for (let i = 0; i < 12; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        articles.push(await generateArticle(user.id));
      }

      // eslint-disable-next-line no-restricted-syntax
      for await (const article of articles) {
        await Promise.all(users.map(userItem => generateComment(userItem.id, article.slug)));
      }
    }
  } catch (e) {
    console.error(e);
    throw e; // fail the command (exit 1) instead of reporting a partial seed as done
  }
};

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async () => {
    await prisma.$disconnect();
    process.exit(1);
  });
