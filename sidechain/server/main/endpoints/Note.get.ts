import ApiHandler from '@ulixee/payment-utils/api/SidechainApiHandler';
import Note from '../models/Note';

export default new ApiHandler('Note.get', {
  async handler({ noteHash }, options) {
    const note = await Note.load(noteHash, options);
    return {
      note: note.data,
    };
  },
});
