import fs from 'fs';
import pdf from 'pdf-parse';

const dataBuffer = fs.readFileSync('thinc!_Hackathon_Case-Study_I_comstruct.pdf');

pdf(dataBuffer).then(function(data) {
    fs.writeFileSync('pdf_text_output.txt', data.text);
    console.log('PDF text extracted to pdf_text_output.txt');
}).catch(err => {
    console.error('Error reading PDF:', err);
});
