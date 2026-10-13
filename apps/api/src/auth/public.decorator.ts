import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'doccheck:public';

/** Route (or controller) reachable without signing in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
