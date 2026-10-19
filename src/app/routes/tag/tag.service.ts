import prisma from '../../../prisma/prisma-client';
import { Tag } from './tag.model';
import { cached } from '../../cache';

const TAGS_TTL_SECONDS = 60;

const getTags = async (id?: number): Promise<string[]> =>
  // Signed-in users also see their own tags, so the key includes the user.
  cached('tags', id ? `user-${id}` : 'anonymous', TAGS_TTL_SECONDS, () => loadTags(id));

const loadTags = async (id?: number): Promise<string[]> => {
  const queries = [];
  queries.push({ demo: true });

  if (id) {
    queries.push({
      id: {
        equals: id,
      },
    });
  }

  const tags = await prisma.tag.findMany({
    where: {
      articles: {
        some: {
          author: {
            OR: queries,
          },
        },
      },
    },
    select: {
      name: true,
    },
    orderBy: {
      articles: {
        _count: 'desc',
      },
    },
    take: 10,
  });

  return tags.map((tag: Tag) => tag.name);
};

export default getTags;
