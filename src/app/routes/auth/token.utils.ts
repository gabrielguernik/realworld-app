import * as jwt from 'jsonwebtoken';
import config from '../../config';

const generateToken = (id: number): string =>
  jwt.sign({ user: { id } }, config.jwtSecret, {
    expiresIn: '60d',
  });

export default generateToken;
