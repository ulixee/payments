import Note from '../models/Note';
import ApiHandler from '../../utils/ApiHandler';

export default new ApiHandler('Note.get', {
  async handler({ noteHash }, options) {
    const note = await Note.load(noteHash, options.logger);
    return {
      note: note.data,
    };
  },
});
