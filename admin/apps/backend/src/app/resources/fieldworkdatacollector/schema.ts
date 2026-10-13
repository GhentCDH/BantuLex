import { z } from 'zod';
import { fieldworkdatacollectorSchema } from '../../../../../../generated/types/index.js';
export default fieldworkdatacollectorSchema.extend({id:z.string()});
