const mockttp = require('mockttp');
const fs = require('fs');
const axios = require('axios');

(async () => {
  if (!fs.existsSync('./ssl/key.pem') || !fs.existsSync('./ssl/cert.pem')) {
    const { key, cert } = await mockttp.generateCACertificate();
    if (!fs.existsSync('./ssl')) await fs.promises.mkdir('./ssl');

    await fs.promises.writeFile('./ssl/key.pem', key);
    await fs.promises.writeFile('./ssl/cert.pem', cert);

    console.log('PLEASE INSTALL ./ssl/cert.pem INTO YOUR BROWSER! If asked, select "Trust this CA to identify webistes" or similar.');
  }

  const server = mockttp.getLocal({
    https: {
      keyPath: './ssl/key.pem',
      certPath: './ssl/cert.pem',
    },
  });

  let ClozeCombiInteractionReq;
  server
    .forPost('/api/content/exercise/submit')
    .forHostname('kampus.sanomapro.fi')
    .thenPassThrough({
      beforeRequest: async (request) => {
        let json = await request.body.getJson();

        if (json.document.contentType == 'ClozeCombiInteraction') {
          ClozeCombiInteractionReq = request;
        }
      },

      beforeResponse: async (response) => {
        let json = await response.body.getJson();

        if (json.document.contentType == 'ClozeCombiInteraction') {
          let answers = new Map([['incorrect', []]]);

          let postbody = await ClozeCombiInteractionReq.body.getJson();
          delete ClozeCombiInteractionReq.headers['content-length'];

          while (json.score != json.maxScore) {
            for (clozeContent of json.document.itemBody[1].interaction.clozeContents) {
              for (const clozeCombi of clozeContent.paragraph.clozeCombi) {
                if (clozeCombi.choices) {
                  if (clozeCombi.correct) {
                    answers.set(clozeCombi.id, { correct: clozeCombi.selectedChoiceId });
                  } else {
                    for (const choice of clozeCombi.choices) {
                      if (choice.selected && !answers.get('incorrect').includes(choice.id)) {
                        answers.get('incorrect').push(choice.id);
                      } else if (!choice.selected && (!answers.get(clozeCombi.id) || !answers.get(clozeCombi.id).untested || !answers.get(clozeCombi.id).untested.includes(choice.id))) {
                        if (!answers.get('incorrect').includes(choice.id) && (!answers.get(clozeCombi.id) || !answers.get(clozeCombi.id).untested)) {
                          answers.set(clozeCombi.id, { untested: [choice.id] });
                        } else if (!answers.get('incorrect').includes(choice.id) && answers.get(clozeCombi.id).untested.length >= clozeCombi.choices.length - 1) {
                          answers.set(clozeCombi.id, { correct: clozeCombi.selectedChoiceId });
                        } else if (!answers.get('incorrect').includes(choice.id)) {
                          answers.get(clozeCombi.id).untested.push(choice.id);
                        }
                      }
                    }
                  }
                }
              }
            }

            for (clozeContent of postbody.document.itemBody[1].interaction.clozeContents) {
              for (const clozeCombi of clozeContent.paragraph.clozeCombi) {
                if (answers.has(clozeCombi.id)) {
                  if (answers.get(clozeCombi.id).correct) {
                    clozeCombi.selectedChoiceId = answers.get(clozeCombi.id).correct;
                  } else if (answers.get(clozeCombi.id).untested) {
                    clozeCombi.selectedChoiceId = answers.get(clozeCombi.id).untested[0];
                    answers.get(clozeCombi.id).untested = answers.get(clozeCombi.id).untested.filter((e) => e !== clozeCombi.selectedChoiceId);
                  }
                }
              }
            }

            json = (await axios.post(ClozeCombiInteractionReq.url, postbody, { headers: ClozeCombiInteractionReq.headers })).data;
          }

          return {
            body: JSON.stringify(json),
          };
        }
      },
    });

  let ChoiceInteractionXopusReq;
  server
    .forPost('/api/combicontent/exercise/submit')
    .forHostname('kampus.sanomapro.fi')
    .thenPassThrough({
      beforeRequest: async (request) => {
        let json = await request.body.getJson();

        if (json.documents[0].contentType == 'ChoiceInteractionXopus') {
          ChoiceInteractionXopusReq = request;
          for (const document of json.documents) {
            for (const itemBody of document.itemBody) {
              if (itemBody.interaction) {
                for (const choice of itemBody.interaction.choices) {
                  choice.selected = true;
                }
              }
            }
          }

          return {
            body: JSON.stringify(json),
          };
        } else if (json.documents[0].contentType == 'MatchSingleResponseInteraction') {
        }
      },

      beforeResponse: async (response) => {
        let json = await response.body.getJson();

        if (json.documents[0].contentType == 'ChoiceInteractionXopus') {
          for (const document of json.documents) {
            for (const itemBody of document.itemBody) {
              if (itemBody.interaction) {
                for (const choice of itemBody.interaction.choices) {
                  if (!choice.correct) choice.selected = false;
                }
              }
            }
          }

          let postbody = await ChoiceInteractionXopusReq.body.getJson();
          delete ChoiceInteractionXopusReq.headers['content-length'];

          for (const document of postbody.documents) {
            const correspondingDocument = json.documents.find((doc) => doc.id === document.id);
            if (correspondingDocument) {
              for (const itemBody of document.itemBody) {
                if (itemBody.interaction) {
                  for (const choice of itemBody.interaction.choices) {
                    const correspondingChoice = correspondingDocument.itemBody.find((item) => item.interaction).interaction.choices.find((c) => c.id === choice.id);
                    if (correspondingChoice) {
                      choice.selected = correspondingChoice.selected;
                    }
                  }
                }
              }
            }
          }

          await axios.post(ChoiceInteractionXopusReq.url, postbody, { headers: ChoiceInteractionXopusReq.headers });

          return {
            body: JSON.stringify(json),
          };
        } else if (json.documents[0].contentType == 'MatchSingleResponseInteraction') {
        }
      },
    });

  server.forUnmatchedRequest().thenPassThrough();

  await server.start(8080);

  const caFingerprint = mockttp.generateSPKIFingerprint(fs.readFileSync('./ssl/cert.pem'));
  console.log(`Server running on port ${server.port}`);
  console.log(`CA cert fingerprint ${caFingerprint}`);
})();
