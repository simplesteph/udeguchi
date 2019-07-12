const fs = require('fs');
const path = require('path');
const got = require('got');
const { gray, green, yellow, inverse } = require('kleur');
const { headers: original_headers } = require('./references.js');

// Save or download links not from Udemy
const download_asset_external_link = (asset_name, asset_title, asset) => {
	const asset_url = asset['external_url'];

	if (asset_title.match(/\b\.\w{1,4}\b/i)) {
		if (!fs.existsSync(asset_name)) {
			const stream = got.stream(asset_url, {
				headers: { 'User-Agent': original_headers['User-Agent'] }
			});
			stream
				.on('response', res => {
					res.pipe(fs.createWriteStream(asset_name));

					res.on('end', () => {
						console.log(`\n    ${gray(inverse(' Asset '))}  ${asset_title}  ${green(inverse(' Done '))}`);
					});
				})
				.resume();
		}
	} else {
		try {
			const data = fs.readFileSync(`${asset_name}.txt`).toString();
			const urls_in_file = data.split('\n');
			if (!urls_in_file.includes(asset['external_url'].trim())) {
				fs.appendFileSync(`${asset_name}.txt`, `${asset['external_url'].trim()}\n`);
			}
		} catch (error) {
			fs.writeFileSync(`${asset_name}.txt`, `${asset['external_url'].trim()}\n`);
		}
	}
};

// Download files with link from Udemy
const download_asset_file = (asset_name, asset_title, asset) => {
	const asset_url = asset['url_set']['File'][0]['file'];

	const stream = got.stream(asset_url, {
		headers: { 'User-Agent': original_headers['User-Agent'] }
	});
	stream
		.on('response', res => {
			res.pipe(fs.createWriteStream(asset_name));

			res.on('end', () => {
				console.log(`\n    ${gray(inverse(' Asset '))}  ${asset_title}  ${green(inverse(' Done '))}`);
			});
		})
		.resume();
};

const download_supplementary_assets = (content, chapter_path, lecture_index) => {
	if (content.length > 0) {
		const asset = content[0];
		const asset_title = `${lecture_index} ${asset['title']}`.replace(/[/\\?%*:|"<>]/g, '_');
		const asset_name = path.join(chapter_path, asset_title);

		if (asset['asset_type'] === 'ExternalLink') {
			download_asset_external_link(asset_name, asset_title, asset);
		}

		if (asset['asset_type'] === 'File') {
			if (fs.existsSync(asset_name)) {
				console.log(`\n    ${gray(inverse(' Asset '))}  ${asset_title}  ${yellow('(already downloaded)')}`);
			} else {
				download_asset_file(asset_name, asset_title, asset);
			}
		}

		content.shift();
		download_supplementary_assets(content, chapter_path, lecture_index);
	}
};

module.exports = {
	download_supplementary_assets
};
