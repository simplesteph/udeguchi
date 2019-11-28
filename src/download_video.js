const fs = require('fs');
const {exec} = require('child_process');
const path = require('path');
const commander = require('commander');
const {yellow} = require('kleur');
const {get_request, handle_error, green_bg} = require('./utilities.js');
const {headers: original_headers} = require('./references.js');

const download_hls_video = async (url, video_name, chapter_path) => {
	try {
		const response = await get_request(url, {'User-Agent': original_headers['User-Agent']});

		const video_resolutions = response.body.match(/(?:hls_)(\d{3,4})/g).map(r => r.slice(4));

		let video_quality_index = 0;
		let quality_position = ' ';
		if (commander.quality) {
			video_quality_index = video_resolutions.findIndex(r => r === `${commander.quality}`);
			if (video_quality_index !== -1) {
				// -map p:1
				// choose second resolution
				quality_position = ` -map p:${video_quality_index} `;
			}
		}

		await save_video(url, quality_position, video_name, chapter_path);
	} catch (error) {
		if (error['statusCode'] === 403) {
			throw new Error('403');
		}

		handle_error(error['message']);
	}
};

const download_mp4_video = async (urls_location, video_name, chapter_path) => {
	try {
		// ~~... String to Number
		const qualities = urls_location.map(q => ~~q['label']);
		// Highest to lowest sorting
		const sorted_qualities = qualities.sort((el1, el2) => el2 - el1);

		let quality_index = 0;
		if (sorted_qualities.includes(~~commander.quality)) {
			quality_index = sorted_qualities.findIndex(i => i === ~~commander.quality);
		}

		const best_video_quality = urls_location.find(v => v['label'] === `${sorted_qualities[quality_index]}`);

		const video_url = best_video_quality['file'];

		await save_video(video_url, undefined, video_name, chapter_path);
	} catch (error) {
		handle_error(error['message']);
	}
};

const save_video = (url, quality_position, video_name, chapter_path) => {
	if (!url) {
		console.log(`  ${yellow('(no download link)')}`);
		return new Promise(resolve => resolve('Done'));
	}

	const ffmpeg_name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

	const download_command = quality_position
		? `-y -i "${url}"${quality_position}-acodec copy -bsf:a aac_adtstoasc -vcodec`
		: `-headers "User-Agent: ${original_headers['User-Agent']}" -y -i "${url}" -c`;

	return new Promise((resolve, reject) => {
		exec(
			`${path.join(process.cwd(), ffmpeg_name)} ${download_command} copy "${path.join(
				chapter_path,
				'downloading.mp4'
			)}"`,
			{maxBuffer: 1024 * 1024 * 100},
			err => {
				if (err) {
					return reject(new Error('Failed to download the video!'));
				}

				fs.renameSync(path.join(chapter_path, 'downloading.mp4'), path.join(chapter_path, `${video_name}.mp4`));

				console.log(`  ${green_bg('Done')}`);
				resolve('Done');
			}
		);
	});
};

module.exports = {
	download_hls_video,
	download_mp4_video
};
